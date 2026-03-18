/**
 * Flow grouping module: groups dissected packets into bidirectional
 * conversations (flows) and provides filtering utilities.
 *
 * Pure-logic module — no React, no Node APIs.
 */

import { extractSniFromRaw } from './dissectors/payload.js';

// Ports considered "well-known" for server detection
const WELL_KNOWN_PORTS = new Set([
  20, 21, 22, 23, 25, 53, 67, 68, 80, 110, 119, 123, 143, 161, 162,
  443, 445, 465, 514, 587, 636, 853, 993, 995,
  3260, 3306, 4420, 4789, 5432, 6379, 8009, 8080, 8443, 9092,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Group packets into bidirectional flows.
 *
 * @param {Array} packets - Dissected packet objects (with .layers, .data, etc.)
 * @returns {{
 *   flows: FlowSummary[],
 *   dnsNameMap: Map<string, string>,
 *   packetFlowMap: Map<number, string>
 * }}
 */
export function groupFlows(packets) {
  // Pass 1: DNS correlation — build ip→domain map from DNS responses
  const dnsNameMap = buildDnsNameMap(packets);

  // Pass 2: SNI extraction — build flowId→sni map
  const sniMap = new Map();
  const sniByTuple = new Map(); // normalized key → sni (filled during pass 2)

  for (const pkt of packets) {
    if (!pkt.data || pkt.data.length === 0) continue;
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (!tcp) continue;

    const payloadOffset = findTcpPayloadOffset(pkt);
    if (payloadOffset === null) continue;

    const sni = extractSniFromRaw(pkt.data, payloadOffset);
    if (sni) {
      const key = buildFlowKey(pkt);
      if (key) sniByTuple.set(key, sni);
    }
  }

  // Pass 3: Group packets into flows
  const flowMap = new Map(); // flowKey → { packets, meta }
  const packetFlowMap = new Map(); // packetIndex → flowKey

  for (let i = 0; i < packets.length; i++) {
    const pkt = packets[i];
    const key = buildFlowKey(pkt);
    if (!key) continue;

    if (!flowMap.has(key)) {
      flowMap.set(key, {
        packets: [],
        indices: [],
        firstTs: pkt.timestamp || 0,
        lastTs: pkt.timestamp || 0,
        bytes: 0,
      });
    }

    const entry = flowMap.get(key);
    entry.packets.push(pkt);
    entry.indices.push(pkt.index ?? i);
    entry.bytes += pkt.capturedLen || pkt.originalLen || 0;
    const ts = pkt.timestamp || 0;
    if (ts < entry.firstTs) entry.firstTs = ts;
    if (ts > entry.lastTs) entry.lastTs = ts;

    packetFlowMap.set(pkt.index ?? i, key);
  }

  // Copy sniByTuple into sniMap
  for (const [key, sni] of sniByTuple) {
    sniMap.set(key, sni);
  }

  // Build flow summaries
  const flows = [];
  for (const [key, entry] of flowMap) {
    const summary = buildFlowSummary(key, entry, sniMap, dnsNameMap);
    flows.push(summary);
  }

  // Sort by packet count descending
  flows.sort((a, b) => b.packetCount - a.packetCount);

  return { flows, dnsNameMap, packetFlowMap };
}

/**
 * Return packets that belong to the given set of flow IDs.
 *
 * @param {Array} packets - All dissected packets
 * @param {Set|Array} selectedFlowIds - Flow IDs to include
 * @param {Map<number, string>} packetFlowMap - Mapping from packet index to flow ID
 * @returns {Array} - Filtered packets
 */
export function filterPacketsByFlows(packets, selectedFlowIds, packetFlowMap) {
  const idSet = selectedFlowIds instanceof Set ? selectedFlowIds : new Set(selectedFlowIds);
  return packets.filter((pkt, i) => {
    const flowId = packetFlowMap.get(pkt.index ?? i);
    return flowId && idSet.has(flowId);
  });
}

/**
 * Filter a list of flow summaries by criteria (all fields ANDed).
 *
 * @param {FlowSummary[]} flows
 * @param {Object} filterSpec - Filter criteria
 * @param {string} [filterSpec.sni] - Match flow.serverName
 * @param {string} [filterSpec.dst_host] - Match flow.serverIp
 * @param {number} [filterSpec.dst_port] - Match flow.serverPort
 * @param {string} [filterSpec.server_name] - Match serverName (SNI or DNS)
 * @param {string} [filterSpec.protocol] - Substring match on flow.protocol
 * @returns {FlowSummary[]}
 */
export function filterFlows(flows, filterSpec) {
  if (!filterSpec || Object.keys(filterSpec).length === 0) return flows;

  return flows.filter(flow => {
    if (filterSpec.sni != null) {
      if (!flow.serverName || !matchString(flow.serverName, filterSpec.sni)) return false;
    }
    if (filterSpec.dst_host != null) {
      if (!matchString(flow.serverIp, filterSpec.dst_host)) return false;
    }
    if (filterSpec.dst_port != null) {
      if (flow.serverPort !== filterSpec.dst_port) return false;
    }
    if (filterSpec.server_name != null) {
      if (!flow.serverName || !matchString(flow.serverName, filterSpec.server_name)) return false;
    }
    if (filterSpec.protocol != null) {
      if (!flow.protocol.toLowerCase().includes(filterSpec.protocol.toLowerCase())) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Build a DNS name map from DNS response packets: IP → domain name.
 */
function buildDnsNameMap(packets) {
  const map = new Map();

  for (const pkt of packets) {
    const dnsLayer = pkt.layers.find(l =>
      l.name === 'DNS Response' || (l.name && l.name.startsWith('DNS') && l.fields?.type === 'Response')
    );
    if (!dnsLayer) continue;

    const queryName = dnsLayer.fields.query_name;
    const answerIps = dnsLayer.fields.answer_ips;
    if (!queryName || !answerIps || answerIps.length === 0) continue;

    for (const ip of answerIps) {
      // First mapping wins (don't overwrite with later responses for same IP)
      if (!map.has(ip)) {
        map.set(ip, queryName);
      }
    }
  }

  return map;
}

/**
 * Build a normalized bidirectional flow key for a packet.
 * Returns null for packets that can't be keyed.
 */
function buildFlowKey(pkt) {
  const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  const tcp = pkt.layers.find(l => l.name === 'TCP');
  const udp = pkt.layers.find(l => l.name === 'UDP');

  if (ip && (tcp || udp)) {
    const transport = tcp || udp;
    const proto = tcp ? 'TCP' : 'UDP';
    const srcIp = ip.fields.src_ip;
    const dstIp = ip.fields.dst_ip;
    const srcPort = transport.fields.src_port;
    const dstPort = transport.fields.dst_port;

    // Normalize: sort endpoints lexicographically
    const a = `${srcIp}:${srcPort}`;
    const b = `${dstIp}:${dstPort}`;
    return a < b ? `${proto}-${a}-${b}` : `${proto}-${b}-${a}`;
  }

  // ARP, ICMP, and other non-port protocols
  if (ip) {
    const protoName = ip.fields.protocol_name || `Proto${ip.fields.protocol}`;
    const srcIp = ip.fields.src_ip;
    const dstIp = ip.fields.dst_ip;
    const a = srcIp < dstIp ? srcIp : dstIp;
    const b = srcIp < dstIp ? dstIp : srcIp;
    return `${protoName}-${a}-${b}`;
  }

  // ARP (no IP layer)
  const arp = pkt.layers.find(l => l.name === 'ARP');
  if (arp) {
    const senderIp = arp.fields.sender_ip || '';
    const targetIp = arp.fields.target_ip || '';
    const a = senderIp < targetIp ? senderIp : targetIp;
    const b = senderIp < targetIp ? targetIp : senderIp;
    return `ARP-${a}-${b}`;
  }

  // Ethernet-only (no IP)
  const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
  if (eth) {
    const srcMac = eth.fields.src_mac;
    const dstMac = eth.fields.dst_mac;
    const a = srcMac < dstMac ? srcMac : dstMac;
    const b = srcMac < dstMac ? dstMac : srcMac;
    return `L2-${a}-${b}`;
  }

  return null;
}

/**
 * Find the TCP payload offset within the raw packet data.
 */
function findTcpPayloadOffset(pkt) {
  const tcp = pkt.layers.find(l => l.name === 'TCP');
  if (!tcp) return null;

  // Walk layers to find the TCP header, then use its data_offset
  const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
  const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (!eth || !ip) return null;

  const ethLen = 14; // Standard Ethernet II header
  const ipLen = ip.fields.ihl || 20;
  const tcpDataOffset = tcp.fields.data_offset || 20;

  return ethLen + ipLen + tcpDataOffset;
}

/**
 * Detect which side is the server and build a FlowSummary.
 */
function buildFlowSummary(key, entry, sniMap, dnsNameMap) {
  const { packets, indices, firstTs, lastTs, bytes } = entry;
  const firstPkt = packets[0];

  const ip = firstPkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  const tcp = firstPkt.layers.find(l => l.name === 'TCP');
  const udp = firstPkt.layers.find(l => l.name === 'UDP');
  const transport = tcp || udp;

  let serverIp = null;
  let serverPort = null;
  let clientIp = null;
  let clientPort = null;
  let protocolStack = key.split('-')[0]; // Base protocol from key

  if (ip && transport) {
    const srcIp = ip.fields.src_ip;
    const dstIp = ip.fields.dst_ip;
    const srcPort = transport.fields.src_port;
    const dstPort = transport.fields.dst_port;

    // Determine server side: prefer SYN detection for TCP, else well-known port
    const serverSide = detectServer(packets, srcIp, dstIp, srcPort, dstPort);
    if (serverSide === 'dst') {
      serverIp = dstIp;
      serverPort = dstPort;
      clientIp = srcIp;
      clientPort = srcPort;
    } else {
      serverIp = srcIp;
      serverPort = srcPort;
      clientIp = dstIp;
      clientPort = dstPort;
    }
  } else if (ip) {
    // No transport (ICMP etc.)
    serverIp = ip.fields.dst_ip;
    clientIp = ip.fields.src_ip;
  }

  // Protocol stack refinement
  const hasTLS = packets.some(p => p.layers.some(l =>
    l.name.startsWith('TLS') || l.name.includes('TLS')
  ));
  const hasDNS = packets.some(p => p.layers.some(l =>
    l.name.startsWith('DNS')
  ));
  const hasHTTP = packets.some(p => p.layers.some(l =>
    l.name === 'HTTP' || l.name.startsWith('HTTP')
  ));

  if (hasTLS && hasHTTP) {
    protocolStack = `${protocolStack}/TLS/HTTP`;
  } else if (hasTLS) {
    protocolStack = `${protocolStack}/TLS`;
  } else if (hasHTTP) {
    protocolStack = `${protocolStack}/HTTP`;
  } else if (hasDNS) {
    protocolStack = `${protocolStack}/DNS`;
  }

  // Server name resolution: SNI > DNS > null
  const sni = sniMap.get(key) || null;
  let serverName = sni;
  if (!serverName && serverIp) {
    serverName = dnsNameMap.get(serverIp) || null;
  }

  return {
    id: key,
    protocol: protocolStack,
    serverName,
    serverIp: serverIp || '',
    serverPort: serverPort ?? 0,
    clientIp: clientIp || '',
    clientPort: clientPort ?? 0,
    packetCount: packets.length,
    bytes,
    durationMs: Math.round((lastTs - firstTs) * 1000),
    hasTLS,
    hasDNS,
    packetIndices: indices,
  };
}

/**
 * Determine which side of the first packet is the server.
 * Returns 'dst' if dstIp:dstPort is the server, 'src' otherwise.
 */
function detectServer(packets, srcIp, dstIp, srcPort, dstPort) {
  // Check for TCP SYN (the destination of a SYN is the server)
  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (!tcp) continue;
    const flags = tcp.fields.flag_names || '';
    if (flags.includes('SYN') && !flags.includes('ACK')) {
      const pktIp = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
      if (pktIp) {
        // The destination of the SYN is the server
        return pktIp.fields.dst_ip === dstIp ? 'dst' : 'src';
      }
    }
  }

  // Fallback: well-known port heuristic
  const dstWellKnown = WELL_KNOWN_PORTS.has(dstPort) || dstPort < 1024;
  const srcWellKnown = WELL_KNOWN_PORTS.has(srcPort) || srcPort < 1024;

  if (dstWellKnown && !srcWellKnown) return 'dst';
  if (srcWellKnown && !dstWellKnown) return 'src';

  // Both or neither: lower port is probably the server
  return dstPort <= srcPort ? 'dst' : 'src';
}

/**
 * Case-insensitive glob/substring match.
 * Supports '*' wildcard at start/end for simple patterns.
 */
function matchString(value, pattern) {
  if (!value || !pattern) return false;
  const v = value.toLowerCase();
  const p = pattern.toLowerCase();

  if (p.startsWith('*') && p.endsWith('*')) {
    return v.includes(p.slice(1, -1));
  }
  if (p.startsWith('*')) {
    return v.endsWith(p.slice(1));
  }
  if (p.endsWith('*')) {
    return v.startsWith(p.slice(0, -1));
  }
  return v === p || v.includes(p);
}
