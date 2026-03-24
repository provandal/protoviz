/**
 * Rule-based spec compliance checker for dissected packets.
 *
 * Rule types:
 *   - field_value: Check that a specific field matches expected value(s)
 *   - sequence: Check for PSN gaps in RoCE traffic
 *   - sequence_pattern: Check for expected packet sequence patterns
 */

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

  return findings.sort((a, b) => a.packetIndex - b.packetIndex);
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
            packetIndex: pkt.index,
            rule: rule.id,
            description: rule.description || `Invalid ${rule.field}: ${val}`,
            spec_ref: rule.spec_ref,
          });
        }
      }
    }
  }
  return findings;
}

function checkPsnSequence(rule, packets) {
  const findings = [];
  // Group by QP
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
          packetIndex: curr.index,
          rule: rule.id || 'psn_gap',
          description: `PSN gap on QP ${qp}: expected ${expectedPsn}, got ${curr.psn} (prev: ${prev.psn})`,
          spec_ref: rule.spec_ref || 'IB Spec Vol 1, §9.5.1',
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
      findings.push({
        severity: rule.severity || 'error',
        packetIndex: pkt.index,
        rule: rule.id,
        description: rule.description || `TCP ${flag} flag detected`,
        spec_ref: rule.spec_ref,
      });
    }
  }
  return findings;
}

function checkSequencePattern(rule, packets) {
  const findings = [];
  if (!rule.expected_sequence || rule.expected_sequence.length === 0) return findings;

  // Extract RoCE opcodes in order
  const opcodes = [];
  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (bth) {
      opcodes.push({ index: pkt.index, opcode: bth.fields.opcode_name });
    }
  }

  // No RoCE traffic present — skip sequence check entirely
  if (opcodes.length === 0) return findings;

  // Check if expected sequence appears
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
      packetIndex: 0,
      rule: rule.id || 'sequence_pattern',
      description: rule.description || `Expected sequence not found: ${rule.expected_sequence.join(' → ')}`,
      spec_ref: rule.spec_ref,
    });
  }

  return findings;
}
