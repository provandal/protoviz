/**
 * Self-contained flow grouping for the MCP server.
 *
 * Groups dissected packets (from pcapToScenario.js parseCapture()) into
 * bidirectional network flows, correlates DNS names, extracts TLS SNI,
 * and provides filtering primitives.
 */

// ─── Helpers ────────────────────────────────────────────────────

function readUint16(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

function readUint32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function formatIp(data, offset) {
  return `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
}

// ─── DNS Correlation ────────────────────────────────────────────

/**
 * Parse DNS response packets to build an IP-to-domain mapping.
 * Works with both binary packets (pkt.data) and tshark-parsed layers.
 *
 * @param {object[]} packets - Dissected packets from parseCapture()
 * @returns {Map<string, string>} IP address -> domain name
 */
function buildDnsNameMap(packets) {
  const dnsNameMap = new Map();

  for (const pkt of packets) {
    // Strategy 1: tshark-parsed DNS layers
    const dnsLayer = pkt.layers.find(l => l.name === 'DNS');
    if (dnsLayer && dnsLayer.fields) {
      // tshark DNS layers have fields like dns.qry.name, dns.a, dns.aaaa, etc.
      const queryName = dnsLayer.fields.qry_name || dnsLayer.fields['dns.qry.name'] || '';
      const answerIps = [];
      // Collect A record answers
      for (const [k, v] of Object.entries(dnsLayer.fields)) {
        if ((k === 'a' || k === 'dns.a' || k === 'aaaa' || k === 'dns.aaaa') && typeof v === 'string') {
          // Could be comma-separated if multiple
          for (const ip of v.split(',')) {
            const trimmed = ip.trim();
            if (trimmed) answerIps.push(trimmed);
          }
        }
      }
      if (queryName && answerIps.length > 0) {
        for (const ip of answerIps) {
          dnsNameMap.set(ip, queryName);
        }
      }
      continue;
    }

    // Strategy 2: Parse DNS from raw bytes
    if (!pkt.data || pkt.data.length === 0) continue;

    const udpLayer = pkt.layers.find(l => l.name === 'UDP');
    if (!udpLayer) continue;
    // DNS typically runs on port 53
    if (udpLayer.fields.src_port !== 53 && udpLayer.fields.dst_port !== 53) continue;
    // Only parse responses (src_port === 53)
    if (udpLayer.fields.src_port !== 53) continue;

    try {
      const dnsEntries = parseDnsResponseFromRaw(pkt.data);
      for (const { name, ip } of dnsEntries) {
        dnsNameMap.set(ip, name);
      }
    } catch {
      // Skip malformed DNS
    }
  }

  return dnsNameMap;
}

/**
 * Parse DNS response from raw Ethernet frame bytes.
 * Returns array of { name, ip } from A/AAAA answer records.
 */
function parseDnsResponseFromRaw(data) {
  const results = [];
  if (!data || data.length < 14) return results;

  // Find UDP payload offset: Ethernet(14) + IPv4(variable) + UDP(8)
  const ethertype = readUint16(data, 12);
  if (ethertype !== 0x0800) return results; // IPv4 only for now

  const ipOffset = 14;
  if (data.length < ipOffset + 20) return results;
  const ihl = (data[ipOffset] & 0x0f) * 4;
  const protocol = data[ipOffset + 9];
  if (protocol !== 17) return results; // UDP only

  const udpOffset = ipOffset + ihl;
  if (data.length < udpOffset + 8) return results;

  const dnsOffset = udpOffset + 8;
  if (data.length < dnsOffset + 12) return results;

  // DNS header
  const flags = readUint16(data, dnsOffset + 2);
  const qr = (flags >> 15) & 1;
  if (qr !== 1) return results; // Only responses

  const qdCount = readUint16(data, dnsOffset + 4);
  const anCount = readUint16(data, dnsOffset + 6);
  if (anCount === 0) return results;

  let offset = dnsOffset + 12;

  // Skip question section
  for (let i = 0; i < qdCount; i++) {
    const { newOffset } = skipDnsName(data, offset, dnsOffset);
    if (newOffset < 0) return results;
    offset = newOffset + 4; // QTYPE(2) + QCLASS(2)
    if (offset > data.length) return results;
  }

  // Read the query name from the first question for correlation
  let queryName = '';
  if (qdCount > 0) {
    const { name } = readDnsName(data, dnsOffset + 12, dnsOffset);
    queryName = name;
  }

  // Parse answer section
  for (let i = 0; i < anCount; i++) {
    if (offset + 12 > data.length) break;

    const { name: answerName, newOffset: nameEnd } = readDnsName(data, offset, dnsOffset);
    if (nameEnd < 0) break;
    offset = nameEnd;

    if (offset + 10 > data.length) break;
    const rrType = readUint16(data, offset);
    const rdLength = readUint16(data, offset + 8);
    offset += 10;

    if (offset + rdLength > data.length) break;

    const recordName = answerName || queryName;

    if (rrType === 1 && rdLength === 4) {
      // A record
      const ip = formatIp(data, offset);
      if (recordName) results.push({ name: recordName, ip });
    } else if (rrType === 28 && rdLength === 16) {
      // AAAA record
      const parts = [];
      for (let j = 0; j < 16; j += 2) {
        parts.push(readUint16(data, offset + j).toString(16));
      }
      const ip = parts.join(':');
      if (recordName) results.push({ name: recordName, ip });
    }

    offset += rdLength;
  }

  return results;
}

/**
 * Read a DNS name from the packet, handling compression pointers.
 * Returns { name, newOffset } where newOffset is past the name in the stream.
 */
function readDnsName(data, offset, dnsStart, depth = 0) {
  if (depth > 10) return { name: '', newOffset: -1 }; // Prevent infinite loops
  const parts = [];
  let jumped = false;
  let savedOffset = -1;
  let pos = offset;

  while (pos < data.length) {
    const len = data[pos];
    if (len === 0) {
      pos++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      // Compression pointer
      if (pos + 1 >= data.length) return { name: '', newOffset: -1 };
      if (!jumped) savedOffset = pos + 2;
      jumped = true;
      const ptr = ((len & 0x3f) << 8) | data[pos + 1];
      pos = dnsStart + ptr;
      if (pos >= data.length) return { name: '', newOffset: -1 };
      depth++;
      if (depth > 10) return { name: '', newOffset: -1 };
      continue;
    }
    pos++;
    if (pos + len > data.length) return { name: '', newOffset: -1 };
    let label = '';
    for (let i = 0; i < len; i++) {
      label += String.fromCharCode(data[pos + i]);
    }
    parts.push(label);
    pos += len;
  }

  return {
    name: parts.join('.'),
    newOffset: jumped ? savedOffset : pos,
  };
}

/**
 * Skip over a DNS name in the stream (for skipping question records).
 */
function skipDnsName(data, offset, dnsStart) {
  let pos = offset;
  while (pos < data.length) {
    const len = data[pos];
    if (len === 0) {
      pos++;
      return { newOffset: pos };
    }
    if ((len & 0xc0) === 0xc0) {
      // Compression pointer: 2 bytes
      return { newOffset: pos + 2 };
    }
    pos += 1 + len;
  }
  return { newOffset: -1 };
}

// ─── TLS SNI Extraction ────────────────────────────────────────

/**
 * Build a mapping from flow IDs to TLS SNI hostnames.
 * Inspects TCP payload for TLS ClientHello messages.
 *
 * @param {object[]} packets - Dissected packets
 * @returns {Map<string, string>} flowId -> SNI hostname
 */
function buildSniMap(packets) {
  const sniMap = new Map();

  for (const pkt of packets) {
    // Strategy 1: tshark-parsed TLS/SSL layer
    const tlsLayer = pkt.layers.find(l =>
      l.name === 'TLS' || l.name === 'SSL' || l.name === 'tls' || l.name === 'ssl'
    );
    if (tlsLayer && tlsLayer.fields) {
      const sni = tlsLayer.fields.handshake_extensions_server_name ||
                  tlsLayer.fields['tls.handshake.extensions_server_name'] ||
                  tlsLayer.fields.server_name ||
                  tlsLayer.fields['ssl.handshake.extensions_server_name'] || '';
      if (sni) {
        const flowId = getPacketFlowId(pkt);
        if (flowId) sniMap.set(flowId, sni);
        continue;
      }
    }

    // Strategy 2: Parse TLS ClientHello from raw bytes
    if (!pkt.data || pkt.data.length === 0) continue;

    const tcpLayer = pkt.layers.find(l => l.name === 'TCP');
    if (!tcpLayer) continue;

    try {
      const sni = extractSniFromRaw(pkt.data, tcpLayer);
      if (sni) {
        const flowId = getPacketFlowId(pkt);
        if (flowId) sniMap.set(flowId, sni);
      }
    } catch {
      // Skip malformed TLS
    }
  }

  return sniMap;
}

/**
 * Extract SNI from raw Ethernet frame bytes for a TCP packet.
 */
function extractSniFromRaw(data, tcpLayer) {
  if (!data || data.length < 14) return null;

  const ethertype = readUint16(data, 12);
  if (ethertype !== 0x0800) return null;

  const ipOffset = 14;
  if (data.length < ipOffset + 20) return null;
  const ihl = (data[ipOffset] & 0x0f) * 4;
  const protocol = data[ipOffset + 9];
  if (protocol !== 6) return null; // TCP

  const tcpOffset = ipOffset + ihl;
  if (data.length < tcpOffset + 20) return null;
  const tcpDataOffset = (data[tcpOffset + 12] >> 4) * 4;
  const payloadOffset = tcpOffset + tcpDataOffset;

  if (payloadOffset >= data.length) return null;

  // Check for TLS record: ContentType=0x16 (Handshake)
  if (data[payloadOffset] !== 0x16) return null;
  if (payloadOffset + 5 >= data.length) return null;

  // TLS version (skip)
  // Record length
  const recordLen = readUint16(data, payloadOffset + 3);
  const handshakeOffset = payloadOffset + 5;

  if (handshakeOffset >= data.length) return null;
  // Handshake type: 0x01 = ClientHello
  if (data[handshakeOffset] !== 0x01) return null;

  if (handshakeOffset + 4 >= data.length) return null;

  // Handshake length (3 bytes)
  let pos = handshakeOffset + 4;

  // Client version (2 bytes)
  pos += 2;
  // Client random (32 bytes)
  pos += 32;
  if (pos >= data.length) return null;

  // Session ID
  const sessionIdLen = data[pos];
  pos += 1 + sessionIdLen;
  if (pos + 2 > data.length) return null;

  // Cipher suites
  const cipherSuitesLen = readUint16(data, pos);
  pos += 2 + cipherSuitesLen;
  if (pos + 1 > data.length) return null;

  // Compression methods
  const compMethodsLen = data[pos];
  pos += 1 + compMethodsLen;
  if (pos + 2 > data.length) return null;

  // Extensions
  const extensionsLen = readUint16(data, pos);
  pos += 2;
  const extensionsEnd = pos + extensionsLen;

  while (pos + 4 <= extensionsEnd && pos + 4 <= data.length) {
    const extType = readUint16(data, pos);
    const extLen = readUint16(data, pos + 2);
    pos += 4;

    if (extType === 0x0000) {
      // Server Name Indication
      if (pos + 2 > data.length) return null;
      const sniListLen = readUint16(data, pos);
      let sniPos = pos + 2;
      const sniEnd = sniPos + sniListLen;

      while (sniPos + 3 <= sniEnd && sniPos + 3 <= data.length) {
        const nameType = data[sniPos];
        const nameLen = readUint16(data, sniPos + 1);
        sniPos += 3;

        if (nameType === 0 && sniPos + nameLen <= data.length) {
          let hostname = '';
          for (let i = 0; i < nameLen; i++) {
            hostname += String.fromCharCode(data[sniPos + i]);
          }
          return hostname;
        }
        sniPos += nameLen;
      }
    }

    pos += extLen;
  }

  return null;
}

// ─── Flow Grouping ──────────────────────────────────────────────

/**
 * Extract 5-tuple from a dissected packet and return a normalized flow ID.
 * Both directions of a conversation map to the same flow ID.
 */
function getPacketFlowId(pkt) {
  const ipLayer = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (!ipLayer) return null;

  const srcIp = ipLayer.fields.src_ip || '';
  const dstIp = ipLayer.fields.dst_ip || '';

  const tcpLayer = pkt.layers.find(l => l.name === 'TCP');
  const udpLayer = pkt.layers.find(l => l.name === 'UDP');

  let proto = 'ip';
  let srcPort = 0;
  let dstPort = 0;

  if (tcpLayer) {
    proto = 'tcp';
    srcPort = tcpLayer.fields.src_port || 0;
    dstPort = tcpLayer.fields.dst_port || 0;
  } else if (udpLayer) {
    proto = 'udp';
    srcPort = udpLayer.fields.src_port || 0;
    dstPort = udpLayer.fields.dst_port || 0;
  }

  // Normalize: sort endpoints lexicographically so both directions map to same key
  const endpointA = `${srcIp}:${srcPort}`;
  const endpointB = `${dstIp}:${dstPort}`;

  if (endpointA <= endpointB) {
    return `${proto}-${endpointA}-${endpointB}`;
  } else {
    return `${proto}-${endpointB}-${endpointA}`;
  }
}

/**
 * Extract the directional 5-tuple from a packet (not normalized).
 */
function getPacketEndpoints(pkt) {
  const ipLayer = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (!ipLayer) return null;

  const srcIp = ipLayer.fields.src_ip || '';
  const dstIp = ipLayer.fields.dst_ip || '';

  const tcpLayer = pkt.layers.find(l => l.name === 'TCP');
  const udpLayer = pkt.layers.find(l => l.name === 'UDP');

  let proto = 'ip';
  let srcPort = 0;
  let dstPort = 0;

  if (tcpLayer) {
    proto = 'tcp';
    srcPort = tcpLayer.fields.src_port || 0;
    dstPort = tcpLayer.fields.dst_port || 0;
  } else if (udpLayer) {
    proto = 'udp';
    srcPort = udpLayer.fields.src_port || 0;
    dstPort = udpLayer.fields.dst_port || 0;
  }

  return { proto, srcIp, srcPort, dstIp, dstPort };
}

/**
 * Determine which side is the server for a flow.
 * Uses well-known ports (< 1024), then SYN direction as tiebreaker.
 */
function detectServer(packets, flowId) {
  // Collect first packet's endpoints
  let firstPkt = null;
  let synPkt = null;

  for (const pkt of packets) {
    if (getPacketFlowId(pkt) !== flowId) continue;
    if (!firstPkt) firstPkt = pkt;

    // Check for SYN (without ACK) to determine client->server direction
    const tcpLayer = pkt.layers.find(l => l.name === 'TCP');
    if (tcpLayer) {
      const flags = tcpLayer.fields.flag_names || '';
      if (flags.includes('SYN') && !flags.includes('ACK')) {
        synPkt = pkt;
        break;
      }
    }
  }

  const pkt = synPkt || firstPkt;
  if (!pkt) return null;

  const endpoints = getPacketEndpoints(pkt);
  if (!endpoints) return null;

  // If we have a SYN, the destination is the server
  if (synPkt) {
    return {
      serverIp: endpoints.dstIp,
      serverPort: endpoints.dstPort,
      clientIp: endpoints.srcIp,
      clientPort: endpoints.srcPort,
    };
  }

  // Use well-known port heuristic: port < 1024 is likely the server
  const srcWellKnown = endpoints.srcPort > 0 && endpoints.srcPort < 1024;
  const dstWellKnown = endpoints.dstPort > 0 && endpoints.dstPort < 1024;

  if (dstWellKnown && !srcWellKnown) {
    return {
      serverIp: endpoints.dstIp,
      serverPort: endpoints.dstPort,
      clientIp: endpoints.srcIp,
      clientPort: endpoints.srcPort,
    };
  }
  if (srcWellKnown && !dstWellKnown) {
    return {
      serverIp: endpoints.srcIp,
      serverPort: endpoints.srcPort,
      clientIp: endpoints.dstIp,
      clientPort: endpoints.dstPort,
    };
  }

  // Fallback: lower port is the server
  if (endpoints.dstPort <= endpoints.srcPort) {
    return {
      serverIp: endpoints.dstIp,
      serverPort: endpoints.dstPort,
      clientIp: endpoints.srcIp,
      clientPort: endpoints.srcPort,
    };
  }
  return {
    serverIp: endpoints.srcIp,
    serverPort: endpoints.srcPort,
    clientIp: endpoints.dstIp,
    clientPort: endpoints.dstPort,
  };
}

// ─── Main Exports ───────────────────────────────────────────────

/**
 * Group packets into bidirectional network flows.
 *
 * @param {object[]} packets - Dissected packets from parseCapture()
 * @returns {{ flows: object[], dnsNameMap: Map, packetFlowMap: Map }}
 */
export function groupFlows(packets) {
  // 1. Build DNS and SNI maps
  const dnsNameMap = buildDnsNameMap(packets);
  const sniMap = buildSniMap(packets);

  // 2. Group packets by normalized flow ID
  const flowPackets = new Map();  // flowId -> packet indices
  const packetFlowMap = new Map(); // packet index -> flowId

  for (const pkt of packets) {
    const flowId = getPacketFlowId(pkt);
    if (!flowId) continue;

    if (!flowPackets.has(flowId)) {
      flowPackets.set(flowId, []);
    }
    flowPackets.get(flowId).push(pkt.index);
    packetFlowMap.set(pkt.index, flowId);
  }

  // 3. Build flow summaries
  const flows = [];

  for (const [flowId, indices] of flowPackets) {
    // Detect server side
    const server = detectServer(packets, flowId);
    if (!server) continue;

    // Compute stats
    let bytes = 0;
    let minTs = Infinity;
    let maxTs = -Infinity;
    let hasTLS = false;
    let hasDNS = false;
    let proto = 'ip';

    for (const idx of indices) {
      const pkt = packets[idx];
      bytes += pkt.capturedLen || 0;
      if (pkt.timestamp < minTs) minTs = pkt.timestamp;
      if (pkt.timestamp > maxTs) maxTs = pkt.timestamp;

      for (const layer of pkt.layers) {
        if (layer.name === 'TCP') proto = 'TCP';
        else if (layer.name === 'UDP' && proto !== 'TCP') proto = 'UDP';
        if (layer.name === 'TLS' || layer.name === 'SSL' || layer.name === 'tls' || layer.name === 'ssl') hasTLS = true;
        if (layer.name === 'DNS' || layer.name === 'dns') hasDNS = true;
      }

      // Check for TLS in raw: content type 0x16 in TCP payload
      if (!hasTLS && pkt.data && pkt.data.length > 0) {
        const tcpLayer = pkt.layers.find(l => l.name === 'TCP');
        if (tcpLayer) {
          // Simple heuristic: check if SNI was extracted for this flow
          if (sniMap.has(flowId)) hasTLS = true;
        }
      }

      // Check for DNS (port 53)
      const udpLayer = pkt.layers.find(l => l.name === 'UDP');
      if (udpLayer && (udpLayer.fields.src_port === 53 || udpLayer.fields.dst_port === 53)) {
        hasDNS = true;
      }
    }

    const durationMs = minTs === Infinity ? 0 : Math.round((maxTs - minTs) * 1000);

    // Resolve server name: prefer SNI, then DNS, then IP
    let serverName = sniMap.get(flowId) || '';
    if (!serverName) {
      serverName = dnsNameMap.get(server.serverIp) || '';
    }

    // Detect RoCEv2 specifically
    const hasRoCE = packets.some(p =>
      indices.includes(p.index) && p.layers.some(l => l.name.includes('BTH'))
    );
    const protocol = hasRoCE ? 'RoCEv2' : proto;

    flows.push({
      id: flowId,
      protocol,
      serverName: serverName || server.serverIp,
      serverIp: server.serverIp,
      serverPort: server.serverPort,
      clientIp: server.clientIp,
      clientPort: server.clientPort,
      packetCount: indices.length,
      bytes,
      durationMs,
      hasTLS,
      hasDNS,
      packetIndices: indices,
    });
  }

  // Sort flows by packet count descending
  flows.sort((a, b) => b.packetCount - a.packetCount);

  return { flows, dnsNameMap, packetFlowMap };
}

/**
 * Filter packets to only those belonging to selected flows.
 *
 * @param {object[]} packets - All dissected packets
 * @param {Set<string>} selectedFlowIds - Set of flow IDs to keep
 * @param {Map<number, string>} packetFlowMap - Packet index to flow ID mapping
 * @returns {object[]} Filtered packets (re-indexed)
 */
export function filterPacketsByFlows(packets, selectedFlowIds, packetFlowMap) {
  const filtered = [];
  for (const pkt of packets) {
    const flowId = packetFlowMap.get(pkt.index);
    if (flowId && selectedFlowIds.has(flowId)) {
      filtered.push({ ...pkt, index: filtered.length });
    }
  }
  return filtered;
}

/**
 * Filter flows by a filter specification. All provided filters are ANDed.
 *
 * @param {object[]} flows - Flow summaries from groupFlows()
 * @param {object} filterSpec - Filter criteria
 * @param {string} [filterSpec.sni] - Match TLS SNI hostname (substring, case-insensitive)
 * @param {string} [filterSpec.dst_host] - Match destination/server IP (exact or substring)
 * @param {number} [filterSpec.dst_port] - Match destination/server port (exact)
 * @param {string} [filterSpec.server_name] - Match server name from SNI or DNS (substring, case-insensitive)
 * @param {string} [filterSpec.protocol] - Match protocol (substring, case-insensitive)
 * @returns {object[]} Matching flows
 */
export function filterFlows(flows, filterSpec) {
  if (!filterSpec) return flows;

  return flows.filter(flow => {
    if (filterSpec.sni) {
      // SNI filter: only match flows that have TLS with matching SNI
      if (!flow.hasTLS) return false;
      // serverName may contain the SNI
      if (!flow.serverName.toLowerCase().includes(filterSpec.sni.toLowerCase())) return false;
    }

    if (filterSpec.dst_host) {
      if (!flow.serverIp.includes(filterSpec.dst_host)) return false;
    }

    if (filterSpec.dst_port !== undefined && filterSpec.dst_port !== null) {
      if (flow.serverPort !== filterSpec.dst_port) return false;
    }

    if (filterSpec.server_name) {
      if (!flow.serverName.toLowerCase().includes(filterSpec.server_name.toLowerCase())) return false;
    }

    if (filterSpec.protocol) {
      if (!flow.protocol.toLowerCase().includes(filterSpec.protocol.toLowerCase())) return false;
    }

    return true;
  });
}
