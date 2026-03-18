/**
 * Rule-based spec compliance checker for dissected packets.
 * Ported from src/pcap/ruleEngine.js for the MCP server with additional
 * built-in analysis capabilities.
 *
 * Rule types supported from JSON rule files:
 *   - field_value:      Check that a specific field matches/doesn't match expected value(s)
 *   - psn_sequence:     Detect PSN gaps in RoCE traffic
 *   - tcp_flag_present: Detect TCP RSTs and other flag anomalies
 *   - sequence_pattern: Check for expected opcode sequences
 *
 * Built-in analysis (not from JSON):
 *   - Incomplete TCP handshakes (SYN without SYN-ACK)
 *   - TCP retransmissions (same seq number seen twice)
 *   - One-sided conversations (traffic in only one direction)
 *   - Protocol and conversation counting
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, '..', 'rules');

// ─── Rule Loading ────────────────────────────────────────────────

let rulesCache = null;

export function loadAllRules() {
  if (rulesCache) return rulesCache;

  const allRules = [];
  if (existsSync(RULES_DIR)) {
    const files = readdirSync(RULES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf-8'));
        if (content.rules && Array.isArray(content.rules)) {
          allRules.push(...content.rules);
        }
      } catch (e) {
        // Skip malformed rule files
      }
    }
  }

  rulesCache = allRules;
  return allRules;
}

// ─── Rule Evaluation ─────────────────────────────────────────────

export function evaluateRules(rules, dissectedPackets) {
  const findings = [];

  for (const rule of rules) {
    switch (rule.type) {
      case 'field_value':
        findings.push(...checkFieldValue(rule, dissectedPackets));
        break;
      case 'psn_sequence':
        findings.push(...checkPsnSequence(rule, dissectedPackets));
        break;
      case 'sequence_pattern':
        findings.push(...checkSequencePattern(rule, dissectedPackets));
        break;
      case 'tcp_flag_present':
        findings.push(...checkTcpFlagPresent(rule, dissectedPackets));
        break;
    }
  }

  return findings.sort((a, b) => a.packet_index - b.packet_index);
}

function checkFieldValue(rule, packets) {
  const findings = [];
  for (const pkt of packets) {
    for (const layer of pkt.layers) {
      if (layer.name.toLowerCase().includes(rule.layer_match?.toLowerCase() || '')) {
        const val = layer.fields[rule.field];
        if (val !== undefined && rule.invalid_values?.includes(val)) {
          findings.push({
            severity: rule.severity || 'warning',
            packet_index: pkt.index,
            rule_id: rule.id,
            description: rule.description || `Invalid ${rule.field}: ${val}`,
            spec_ref: rule.spec_ref || null,
            context: {
              layer: layer.name,
              field: rule.field,
              value: val,
            },
          });
        }
      }
    }
  }
  return findings;
}

function checkPsnSequence(rule, packets) {
  const findings = [];
  const qpStreams = {};

  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (!bth) continue;

    const qp = bth.fields.dest_qp;
    if (!qpStreams[qp]) qpStreams[qp] = [];
    qpStreams[qp].push({ index: pkt.index, psn: bth.fields.psn, opcode: bth.fields.opcode_name });
  }

  for (const [qp, stream] of Object.entries(qpStreams)) {
    for (let i = 1; i < stream.length; i++) {
      const prev = stream[i - 1];
      const curr = stream[i];
      const expectedPsn = (prev.psn + 1) & 0x00ffffff; // 24-bit wrap
      if (curr.psn !== expectedPsn && curr.psn !== prev.psn) {
        findings.push({
          severity: rule.severity || 'error',
          packet_index: curr.index,
          rule_id: rule.id || 'psn_gap',
          description: `PSN gap on QP ${qp}: expected ${expectedPsn}, got ${curr.psn} (previous PSN: ${prev.psn}, opcode: ${prev.opcode})`,
          spec_ref: rule.spec_ref || 'IB Spec Vol 1, \u00a79.5.1',
          context: {
            qp: Number(qp),
            expected_psn: expectedPsn,
            actual_psn: curr.psn,
            previous_psn: prev.psn,
            previous_opcode: prev.opcode,
            current_opcode: curr.opcode,
          },
        });
      }
    }
  }

  return findings;
}

function checkTcpFlagPresent(rule, packets) {
  const findings = [];
  const flag = rule.flag;
  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (!tcp) continue;
    const flagNames = tcp.fields.flag_names || '';
    if (flagNames.includes(flag)) {
      const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
      findings.push({
        severity: rule.severity || 'error',
        packet_index: pkt.index,
        rule_id: rule.id,
        description: rule.description || `TCP ${flag} flag detected`,
        spec_ref: rule.spec_ref || null,
        context: {
          flags: flagNames,
          src: ip ? `${ip.fields.src_ip}:${tcp.fields.src_port}` : `port ${tcp.fields.src_port}`,
          dst: ip ? `${ip.fields.dst_ip}:${tcp.fields.dst_port}` : `port ${tcp.fields.dst_port}`,
        },
      });
    }
  }
  return findings;
}

function checkSequencePattern(rule, packets) {
  const findings = [];
  if (!rule.expected_sequence || rule.expected_sequence.length === 0) return findings;

  const opcodes = [];
  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (bth) {
      opcodes.push({ index: pkt.index, opcode: bth.fields.opcode_name });
    }
  }

  let matchIdx = 0;
  for (const op of opcodes) {
    if (op.opcode.toLowerCase().includes(rule.expected_sequence[matchIdx].toLowerCase())) {
      matchIdx++;
      if (matchIdx >= rule.expected_sequence.length) break;
    }
  }

  if (matchIdx < rule.expected_sequence.length) {
    findings.push({
      severity: rule.severity || 'info',
      packet_index: 0,
      rule_id: rule.id || 'sequence_pattern',
      description: rule.description || `Expected sequence not found: ${rule.expected_sequence.join(' \u2192 ')}`,
      spec_ref: rule.spec_ref || null,
      context: {
        expected_sequence: rule.expected_sequence,
        matched_up_to_index: matchIdx,
        missing_from: rule.expected_sequence[matchIdx],
      },
    });
  }

  return findings;
}

// ─── Built-in Analysis ───────────────────────────────────────────

/**
 * Detect incomplete TCP handshakes: SYN without a matching SYN-ACK.
 */
export function detectIncompleteTcpHandshakes(packets) {
  const findings = [];
  // Track SYN packets per conversation (src:port -> dst:port)
  const synPackets = new Map(); // key -> { index, src, dst }

  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (!tcp) continue;
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    const srcIp = ip?.fields.src_ip || '?';
    const dstIp = ip?.fields.dst_ip || '?';
    const flags = tcp.fields.flag_names || '';

    if (flags.includes('SYN') && !flags.includes('ACK')) {
      // This is a pure SYN
      const key = `${srcIp}:${tcp.fields.src_port}->${dstIp}:${tcp.fields.dst_port}`;
      synPackets.set(key, { index: pkt.index, src: `${srcIp}:${tcp.fields.src_port}`, dst: `${dstIp}:${tcp.fields.dst_port}` });
    } else if (flags.includes('SYN') && flags.includes('ACK')) {
      // SYN-ACK — remove the matching SYN
      const reverseKey = `${dstIp}:${tcp.fields.dst_port}->${srcIp}:${tcp.fields.src_port}`;
      synPackets.delete(reverseKey);
    }
  }

  for (const [key, info] of synPackets) {
    findings.push({
      severity: 'warning',
      packet_index: info.index,
      rule_id: 'incomplete_tcp_handshake',
      description: `TCP SYN from ${info.src} to ${info.dst} was never answered with SYN-ACK. The connection attempt may have been rejected, dropped by a firewall, or the response is missing from the capture.`,
      spec_ref: 'RFC 9293, \u00a73.5',
      context: {
        type: 'incomplete_handshake',
        src: info.src,
        dst: info.dst,
      },
    });
  }

  return findings;
}

/**
 * Detect TCP retransmissions: same (src, dst, port, seq) seen more than once.
 */
export function detectTcpRetransmissions(packets) {
  const findings = [];
  const seenSeqs = new Map(); // key -> first packet index

  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (!tcp) continue;
    const flags = tcp.fields.flag_names || '';
    // Ignore SYN and RST (SYN retransmissions handled by handshake check)
    if (flags.includes('SYN') || flags.includes('RST')) continue;
    // Only look at data-bearing or ACK packets
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    const srcIp = ip?.fields.src_ip || '?';
    const dstIp = ip?.fields.dst_ip || '?';

    const key = `${srcIp}:${tcp.fields.src_port}->${dstIp}:${tcp.fields.dst_port}|seq=${tcp.fields.seq_num}`;

    if (seenSeqs.has(key)) {
      findings.push({
        severity: 'warning',
        packet_index: pkt.index,
        rule_id: 'tcp_retransmission',
        description: `TCP retransmission detected: packet ${pkt.index} has same sequence number (${tcp.fields.seq_num}) as packet ${seenSeqs.get(key)} from ${srcIp}:${tcp.fields.src_port} to ${dstIp}:${tcp.fields.dst_port}. This indicates packet loss or delayed ACKs.`,
        spec_ref: 'RFC 9293, \u00a73.4.1',
        context: {
          type: 'retransmission',
          original_packet: seenSeqs.get(key),
          seq_num: tcp.fields.seq_num,
          src: `${srcIp}:${tcp.fields.src_port}`,
          dst: `${dstIp}:${tcp.fields.dst_port}`,
        },
      });
    } else {
      seenSeqs.set(key, pkt.index);
    }
  }

  return findings;
}

/**
 * Detect one-sided conversations: traffic flowing in only one direction.
 */
export function detectOneSidedConversations(conversations) {
  const findings = [];

  for (const conv of conversations) {
    if (conv.packets_a_to_b === 0 || conv.packets_b_to_a === 0) {
      const direction = conv.packets_a_to_b > 0
        ? `${conv.src} -> ${conv.dst}`
        : `${conv.dst} -> ${conv.src}`;
      findings.push({
        severity: 'info',
        packet_index: 0,
        rule_id: 'one_sided_conversation',
        description: `One-sided conversation: traffic only flows ${direction} (${conv.packet_count} packets). The reverse path may be missing from the capture, or this may indicate a scanning/probing pattern.`,
        spec_ref: null,
        context: {
          type: 'one_sided',
          src: conv.src,
          dst: conv.dst,
          protocol: conv.protocol,
          packet_count: conv.packet_count,
          packets_a_to_b: conv.packets_a_to_b,
          packets_b_to_a: conv.packets_b_to_a,
        },
      });
    }
  }

  return findings;
}

// ─── Conversation & Summary Building ─────────────────────────────

/**
 * Build conversation records from dissected packets.
 */
export function buildConversations(packets) {
  const convMap = new Map();

  for (const pkt of packets) {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    if (!ip) continue;

    const tcp = pkt.layers.find(l => l.name === 'TCP');
    const udp = pkt.layers.find(l => l.name === 'UDP');
    const bth = pkt.layers.find(l => l.name.includes('BTH'));

    let protocol = 'IP';
    let srcPort = 0;
    let dstPort = 0;

    if (bth) {
      protocol = 'RoCEv2';
      srcPort = udp?.fields.src_port || 0;
      dstPort = udp?.fields.dst_port || 0;
    } else if (tcp) {
      protocol = 'TCP';
      srcPort = tcp.fields.src_port;
      dstPort = tcp.fields.dst_port;
    } else if (udp) {
      protocol = 'UDP';
      srcPort = udp.fields.src_port;
      dstPort = udp.fields.dst_port;
    }

    const srcIp = ip.fields.src_ip;
    const dstIp = ip.fields.dst_ip;

    // Normalize key so A->B and B->A map to the same conversation
    let keyA, keyB;
    const endpointA = `${srcIp}:${srcPort}`;
    const endpointB = `${dstIp}:${dstPort}`;
    if (endpointA < endpointB) {
      keyA = endpointA;
      keyB = endpointB;
    } else {
      keyA = endpointB;
      keyB = endpointA;
    }
    const key = `${protocol}|${keyA}|${keyB}`;

    if (!convMap.has(key)) {
      convMap.set(key, {
        src: keyA,
        dst: keyB,
        protocol,
        packet_count: 0,
        packets_a_to_b: 0,
        packets_b_to_a: 0,
        first_packet: pkt.index,
        last_packet: pkt.index,
        synopsis_parts: [],
      });
    }

    const conv = convMap.get(key);
    conv.packet_count++;
    conv.last_packet = pkt.index;

    if (endpointA === keyA) {
      conv.packets_a_to_b++;
    } else {
      conv.packets_b_to_a++;
    }

    // Build synopsis from notable events (first 5)
    if (conv.synopsis_parts.length < 5) {
      if (tcp) {
        const flags = tcp.fields.flag_names || '';
        if (flags.includes('SYN') && !flags.includes('ACK')) {
          conv.synopsis_parts.push('SYN');
        } else if (flags.includes('SYN') && flags.includes('ACK')) {
          conv.synopsis_parts.push('SYN-ACK');
        } else if (flags.includes('FIN')) {
          conv.synopsis_parts.push('FIN');
        } else if (flags.includes('RST')) {
          conv.synopsis_parts.push('RST');
        }
      }
      if (bth) {
        const opName = bth.fields.opcode_name || '';
        if (opName && conv.synopsis_parts.length < 5) {
          conv.synopsis_parts.push(opName);
        }
      }
    }
  }

  return Array.from(convMap.values()).map(conv => ({
    src: conv.src,
    dst: conv.dst,
    protocol: conv.protocol,
    packet_count: conv.packet_count,
    packets_a_to_b: conv.packets_a_to_b,
    packets_b_to_a: conv.packets_b_to_a,
    synopsis: conv.synopsis_parts.join(' \u2192 ') || `${conv.packet_count} packets`,
  }));
}

/**
 * Build a protocol summary from dissected packets.
 */
export function buildSummary(packets) {
  const protocols = new Set();
  const endpoints = new Set();
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const pkt of packets) {
    if (pkt.timestamp < minTs) minTs = pkt.timestamp;
    if (pkt.timestamp > maxTs) maxTs = pkt.timestamp;

    for (const layer of pkt.layers) {
      if (layer.name === 'TCP') protocols.add('TCP');
      if (layer.name === 'UDP') protocols.add('UDP');
      if (layer.name === 'ARP') protocols.add('ARP');
      if (layer.name === 'IPv4') protocols.add('IPv4');
      if (layer.name === 'IPv6') protocols.add('IPv6');
      if (layer.name.includes('BTH')) protocols.add('RoCEv2');

      if (layer.fields.src_ip) endpoints.add(layer.fields.src_ip);
      if (layer.fields.dst_ip) endpoints.add(layer.fields.dst_ip);
    }
  }

  const durationMs = minTs === Infinity ? 0 : Math.round((maxTs - minTs) * 1000);

  return {
    packet_count: packets.length,
    protocols: Array.from(protocols),
    endpoints: Array.from(endpoints),
    duration_ms: durationMs,
  };
}

/**
 * Detect TCP-specific issues (RSTs, retransmissions, handshake problems).
 */
export function detectTcpIssues(packets) {
  const issues = [];

  // Count RSTs
  let rstCount = 0;
  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (tcp && (tcp.fields.flag_names || '').includes('RST')) {
      rstCount++;
    }
  }
  if (rstCount > 0) {
    issues.push({
      type: 'tcp_resets',
      details: `${rstCount} TCP RST packet(s) detected. RSTs indicate aborted connections, rejected connection attempts, or firewall interference.`,
      count: rstCount,
    });
  }

  // Detect incomplete handshakes
  const incompleteFindings = detectIncompleteTcpHandshakes(packets);
  if (incompleteFindings.length > 0) {
    issues.push({
      type: 'incomplete_handshakes',
      details: `${incompleteFindings.length} TCP SYN(s) without matching SYN-ACK. Connection attempts may be failing or responses are missing from the capture.`,
      count: incompleteFindings.length,
    });
  }

  // Detect retransmissions
  const retxFindings = detectTcpRetransmissions(packets);
  if (retxFindings.length > 0) {
    issues.push({
      type: 'retransmissions',
      details: `${retxFindings.length} TCP retransmission(s) detected. This indicates packet loss on the network or delayed ACKs.`,
      count: retxFindings.length,
    });
  }

  return issues;
}

/**
 * Detect RoCE-specific issues (PSN gaps, missing ACKs).
 */
export function detectRoceIssues(packets) {
  const issues = [];

  // Group by QP
  const qpStreams = {};
  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (!bth) continue;

    const qp = bth.fields.dest_qp;
    if (!qpStreams[qp]) qpStreams[qp] = [];
    qpStreams[qp].push({ index: pkt.index, psn: bth.fields.psn, opcode: bth.fields.opcode_name });
  }

  // PSN gap detection
  let totalGaps = 0;
  for (const [qp, stream] of Object.entries(qpStreams)) {
    for (let i = 1; i < stream.length; i++) {
      const prev = stream[i - 1];
      const curr = stream[i];
      const expectedPsn = (prev.psn + 1) & 0x00ffffff;
      if (curr.psn !== expectedPsn && curr.psn !== prev.psn) {
        totalGaps++;
      }
    }
  }
  if (totalGaps > 0) {
    issues.push({
      type: 'psn_gaps',
      details: `${totalGaps} PSN gap(s) detected across ${Object.keys(qpStreams).length} QP stream(s). This may indicate dropped packets or out-of-order delivery.`,
      count: totalGaps,
    });
  }

  // Missing ACKs: check if RDMA Write/Read operations have corresponding ACKs
  let writeCount = 0;
  let ackCount = 0;
  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (!bth) continue;
    const op = (bth.fields.opcode_name || '').toLowerCase();
    if (op.includes('write only') || op.includes('write last') || op.includes('read request')) {
      writeCount++;
    }
    if (op.includes('acknowledge') || op.includes('read response')) {
      ackCount++;
    }
  }
  if (writeCount > 0 && ackCount === 0) {
    issues.push({
      type: 'missing_acks',
      details: `${writeCount} RDMA operation(s) found but no ACKs/responses in the capture. The capture may be incomplete or one-sided.`,
      count: writeCount,
    });
  }

  return issues;
}

/**
 * Run the full analysis pipeline on a set of dissected packets.
 * Returns the structured JSON result for the analyze_capture tool.
 */
export function analyzePackets(packets) {
  // 1. Load and run JSON rules
  const rules = loadAllRules();
  const ruleFindings = evaluateRules(rules, packets);

  // 2. Run built-in analysis
  const handshakeFindings = detectIncompleteTcpHandshakes(packets);
  const retxFindings = detectTcpRetransmissions(packets);
  const conversations = buildConversations(packets);
  const oneSidedFindings = detectOneSidedConversations(conversations);

  // 3. Merge all findings
  const allFindings = [
    ...ruleFindings,
    ...handshakeFindings,
    ...retxFindings,
    ...oneSidedFindings,
  ].sort((a, b) => a.packet_index - b.packet_index);

  // 4. Build summary
  const summary = buildSummary(packets);

  // 5. Detect protocol-specific issues
  const tcp_issues = detectTcpIssues(packets);
  const roce_issues = detectRoceIssues(packets);

  return {
    summary,
    findings: allFindings,
    conversations,
    tcp_issues,
    roce_issues,
  };
}
