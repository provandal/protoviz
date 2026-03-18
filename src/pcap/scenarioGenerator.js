/**
 * Comprehensive scenario generator: converts an array of dissected packets
 * into a full ProtoViz scenario object matching scenario.schema.json.
 *
 * Unlike the simpler pcapToScenario (which produces viewer-internal format),
 * this module produces the canonical YAML-schema format with topology, frames[],
 * osi_layers, and timeline referencing frame_ids.  The output can be:
 *   - normalized via normalizeScenario() for the viewer, or
 *   - serialized to YAML for download.
 */

import yaml from 'js-yaml';
import { PHASE_COLORS } from '../utils/constants';
import { PAYLOAD_FIELD_KEYS } from '../utils/sensitiveDataDetector';
import { groupFlows, filterFlows, filterPacketsByFlows } from './flowGrouper.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete scenario from dissected packets.
 *
 * @param {Array} packets - dissected packet objects (from dissect.js pipeline)
 * @param {Object} options
 * @param {string}  [options.title]           - custom title (auto-generated if omitted)
 * @param {boolean} [options.scrub=true]      - replace real IPs/MACs with sanitized values
 * @param {boolean} [options.includePayloads=false] - keep payload hex/ascii fields
 * @param {Object}  [options.flowFilter]      - flow filter spec (see flowGrouper.filterFlows)
 * @returns {{ scenario: Object, warnings: string[], flowInfo?: Object }}
 */
export function generateScenario(packets, options = {}) {
  const {
    title: customTitle,
    scrub = true,
    includePayloads = false,
    flowFilter,
  } = options;

  const warnings = [];
  let flowInfo = undefined;

  // 0. Apply flow filtering if a flowFilter spec is provided
  if (flowFilter && Object.keys(flowFilter).length > 0) {
    const { flows, dnsNameMap, packetFlowMap } = groupFlows(packets);
    const matchedFlows = filterFlows(flows, flowFilter);

    if (matchedFlows.length === 0) {
      warnings.push('Flow filter matched 0 flows — using all packets');
    } else {
      const selectedIds = new Set(matchedFlows.map(f => f.id));
      packets = filterPacketsByFlows(packets, selectedIds, packetFlowMap);
      warnings.push(`Flow filter selected ${matchedFlows.length} flow(s), ${packets.length} packet(s)`);
    }

    flowInfo = {
      totalFlows: flows.length,
      matchedFlows: matchedFlows.length,
      dnsNames: Object.fromEntries(dnsNameMap),
    };
  }

  // 1. Detect sensitive data
  const sensitiveCount = countSensitivePackets(packets);
  if (sensitiveCount > 0) {
    warnings.push(`Sensitive data detected in ${sensitiveCount} packet${sensitiveCount !== 1 ? 's' : ''}`);
  }

  // 2. Extract actors (unique IP/MAC endpoints)
  const { actors, actorMap } = extractActors(packets);

  // 3. Build scrubbing maps (if scrub enabled)
  const scrubMap = scrub ? buildScrubMap(actors) : null;

  // 4. Apply scrubbing to actors
  const scrubbedActors = scrubMap ? actors.map(a => scrubActor(a, scrubMap)) : actors;

  // 5. Detect protocols for metadata
  const protocols = detectProtocols(packets);
  const dominantProto = protocols[0] || 'Captured Traffic';

  // 6. Build topology
  const topology = buildTopology(scrubbedActors);

  // 7. Build OSI layer definitions
  const osiLayers = buildOsiLayers(scrubbedActors, protocols);

  // 8. Build frames library
  const frames = buildFrames(packets, actorMap, scrubMap, includePayloads);

  // 9. Build timeline
  const timeline = buildTimeline(packets, actorMap, frames);

  // 10. Build metadata
  const endpointLabels = scrubbedActors
    .filter(a => a.type === 'host')
    .map(a => a.ip || a.label);
  const autoTitle = endpointLabels.length === 2
    ? `${dominantProto} Conversation: ${endpointLabels[0]} \u2194 ${endpointLabels[1]}`
    : `${dominantProto} Capture \u2014 ${packets.length} packets`;

  const meta = {
    id: 'pcap-generated-' + Date.now(),
    title: customTitle || autoTitle,
    protocol: dominantProto,
    version: '1.0.0',
    description: `Auto-generated scenario from PCAP capture containing ${packets.length} packets. Protocols detected: ${protocols.join(', ') || 'none'}.`,
    authors: [{ name: 'ProtoViz PCAP Generator', org: 'proto-viz', github: 'proto-viz' }],
    difficulty: 'intermediate',
    tags: ['pcap', 'generated', ...protocols.map(p => p.toLowerCase())],
  };

  if (scrub) {
    warnings.push('IP and MAC addresses have been scrubbed');
  }

  const scenario = {
    meta,
    topology,
    osi_layers: osiLayers,
    frames,
    timeline,
  };

  const result = { scenario, warnings };
  if (flowInfo) result.flowInfo = flowInfo;
  return result;
}

/**
 * Serialize a scenario object to YAML string.
 * @param {Object} scenario
 * @returns {string}
 */
export function scenarioToYaml(scenario) {
  return yaml.dump(scenario, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}

// ---------------------------------------------------------------------------
// Actor extraction
// ---------------------------------------------------------------------------

function extractActors(packets) {
  // Track unique endpoints by IP (preferred) or MAC
  const endpoints = new Map(); // key = ip or mac, value = { ip, mac, packetCount }

  for (const pkt of packets) {
    const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');

    const srcMac = eth?.fields.src_mac;
    const dstMac = eth?.fields.dst_mac;
    const srcIp = ip?.fields.src_ip;
    const dstIp = ip?.fields.dst_ip;

    // Source endpoint
    const srcKey = srcIp || srcMac;
    if (srcKey) {
      if (!endpoints.has(srcKey)) {
        endpoints.set(srcKey, { ip: srcIp || null, mac: srcMac || null, packetCount: 0 });
      }
      const e = endpoints.get(srcKey);
      e.packetCount++;
      if (srcMac && !e.mac) e.mac = srcMac;
      if (srcIp && !e.ip) e.ip = srcIp;
    }

    // Destination endpoint
    const dstKey = dstIp || dstMac;
    if (dstKey && dstKey !== 'ff:ff:ff:ff:ff:ff') {
      if (!endpoints.has(dstKey)) {
        endpoints.set(dstKey, { ip: dstIp || null, mac: dstMac || null, packetCount: 0 });
      }
      const e = endpoints.get(dstKey);
      if (dstMac && !e.mac) e.mac = dstMac;
      if (dstIp && !e.ip) e.ip = dstIp;
    }
  }

  // Sort by packet count descending so the most active endpoints are first
  const sorted = [...endpoints.entries()].sort((a, b) => b[1].packetCount - a[1].packetCount);

  const positions = ['left', 'right', 'center'];
  const actors = [];
  const actorMap = new Map(); // key (ip or mac) -> actor id

  sorted.forEach(([key, info], idx) => {
    const letter = String.fromCharCode(65 + idx); // A, B, C, ...
    const id = `host_${letter.toLowerCase()}`;
    const label = info.ip ? `Host ${letter} (${info.ip})` : `Host ${letter} (${info.mac})`;
    const pos = idx < positions.length ? positions[idx] : (idx % 2 === 0 ? 'left' : 'right');

    actors.push({
      id,
      type: 'host',
      label,
      ip: info.ip,
      mac: info.mac,
      position: pos,
    });

    actorMap.set(key, id);
    // Also map by MAC if we have both ip and mac
    if (info.ip && info.mac) {
      actorMap.set(info.mac, id);
    }
  });

  return { actors, actorMap };
}

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

function buildScrubMap(actors) {
  const ipMap = new Map();
  const macMap = new Map();
  let ipCounter = 1;
  let macCounter = 1;

  for (const a of actors) {
    if (a.ip && !ipMap.has(a.ip)) {
      ipMap.set(a.ip, `10.0.0.${ipCounter}`);
      ipCounter++;
    }
    if (a.mac && !macMap.has(a.mac)) {
      macMap.set(a.mac, `00:11:22:33:44:${macCounter.toString(16).padStart(2, '0')}`);
      macCounter++;
    }
  }

  return { ipMap, macMap };
}

function scrubActor(actor, scrubMap) {
  return {
    ...actor,
    ip: actor.ip ? (scrubMap.ipMap.get(actor.ip) || actor.ip) : null,
    mac: actor.mac ? (scrubMap.macMap.get(actor.mac) || actor.mac) : null,
    label: scrubLabel(actor.label, scrubMap),
  };
}

function scrubLabel(label, scrubMap) {
  let result = label;
  for (const [real, sanitized] of scrubMap.ipMap) {
    result = result.replaceAll(real, sanitized);
  }
  for (const [real, sanitized] of scrubMap.macMap) {
    result = result.replaceAll(real, sanitized);
  }
  return result;
}

function scrubValue(value, scrubMap) {
  if (!scrubMap) return value;
  if (typeof value === 'string') {
    let result = value;
    for (const [real, sanitized] of scrubMap.ipMap) {
      result = result.replaceAll(real, sanitized);
    }
    for (const [real, sanitized] of scrubMap.macMap) {
      result = result.replaceAll(real, sanitized);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Protocol detection
// ---------------------------------------------------------------------------

function detectProtocols(packets) {
  const protos = new Map(); // name -> count
  for (const pkt of packets) {
    for (const l of pkt.layers) {
      if (l.name.includes('BTH')) { protos.set('RoCEv2', (protos.get('RoCEv2') || 0) + 1); continue; }
      if (l.name === 'TCP') protos.set('TCP', (protos.get('TCP') || 0) + 1);
      if (l.name === 'UDP') protos.set('UDP', (protos.get('UDP') || 0) + 1);
      if (l.name === 'ARP') protos.set('ARP', (protos.get('ARP') || 0) + 1);
    }
  }
  // Sort by count descending
  return [...protos.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

function buildTopology(actors) {
  const links = [];
  // Create links between every pair of host actors
  const hosts = actors.filter(a => a.type === 'host');
  for (let i = 0; i < hosts.length; i++) {
    for (let j = i + 1; j < hosts.length; j++) {
      links.push({
        id: `link-${hosts[i].id}-${hosts[j].id}`,
        from: hosts[i].id,
        to: hosts[j].id,
        speed_gbps: 10,
      });
    }
  }

  return {
    actors: actors.map(a => ({
      id: a.id,
      type: a.type,
      label: a.label,
      ip: a.ip || undefined,
      mac: a.mac || undefined,
      position: a.position,
    })),
    links,
  };
}

// ---------------------------------------------------------------------------
// OSI Layers
// ---------------------------------------------------------------------------

function buildOsiLayers(actors, protocols) {
  const hasTcp = protocols.includes('TCP');
  const hasUdp = protocols.includes('UDP');
  const hasRoCE = protocols.includes('RoCEv2');

  const result = {};

  for (const actor of actors) {
    if (actor.type === 'switch') continue;

    const layers = [
      {
        layer: 1,
        name: 'Physical',
        components: ['NIC'],
        state_schema: {
          link: { type: 'string', description: 'Physical link state', initial: 'UP' },
        },
      },
      {
        layer: 2,
        name: 'Ethernet',
        components: ['ethernet'],
        state_schema: {
          link_state: { type: 'string', description: 'Data link state', initial: 'up' },
        },
      },
      {
        layer: 3,
        name: 'IPv4',
        components: ['ip'],
        state_schema: {
          ip_addr: { type: 'string', description: 'IP address', initial: actor.ip || 'unknown' },
        },
      },
    ];

    if (hasTcp) {
      layers.push({
        layer: 4,
        name: 'TCP',
        components: ['tcp'],
        state_schema: {
          tcp_state: { type: 'string', description: 'TCP connection state', initial: 'CLOSED' },
        },
      });
    }

    if (hasUdp && !hasTcp) {
      layers.push({
        layer: 4,
        name: 'UDP',
        components: ['udp'],
        state_schema: {
          status: { type: 'string', description: 'UDP socket state', initial: 'idle' },
        },
      });
    }

    if (hasRoCE) {
      layers.push({
        layer: 5,
        name: 'IB Transport (QP)',
        components: ['ib_transport'],
        state_schema: {
          qp_state: { type: 'string', description: 'Queue Pair state', initial: 'RESET' },
        },
      });
    }

    result[actor.id] = layers;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Frames library
// ---------------------------------------------------------------------------

function buildFrames(packets, actorMap, scrubMap, includePayloads) {
  return packets.map((pkt, idx) => {
    const frameId = `frame_${String(idx + 1).padStart(3, '0')}`;
    const { from, to } = resolveFromTo(pkt, actorMap);
    const label = buildPacketLabel(pkt);
    const phase = inferPacketPhase(pkt);
    const color = PHASE_COLORS[phase] || '#475569';

    const headers = pkt.layers
      .map(layer => buildHeader(layer, scrubMap, includePayloads));

    return {
      id: frameId,
      name: scrubMap ? scrubValue(label, scrubMap) : label,
      from,
      to,
      via: [],
      total_bytes: pkt.capturedLen || pkt.originalLen || 0,
      color,
      headers,
    };
  });
}

function resolveFromTo(pkt, actorMap) {
  const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (ip) {
    const fromId = actorMap.get(ip.fields.src_ip) || 'unknown';
    const toId = actorMap.get(ip.fields.dst_ip) || 'unknown';
    return { from: fromId, to: toId };
  }
  const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
  if (eth) {
    const fromId = actorMap.get(eth.fields.src_mac) || 'unknown';
    const dst = eth.fields.dst_mac;
    if (dst === 'ff:ff:ff:ff:ff:ff') {
      return { from: fromId, to: 'broadcast' };
    }
    const toId = actorMap.get(dst) || 'unknown';
    return { from: fromId, to: toId };
  }
  return { from: 'unknown', to: 'unknown' };
}

function buildHeader(layer, scrubMap, includePayloads) {
  const fields = Object.entries(layer.fields)
    .filter(([key]) => {
      // Skip internal fields
      if (key.startsWith('_')) return false;
      // Skip payload fields unless includePayloads
      if (!includePayloads && PAYLOAD_FIELD_KEYS.has(key)) return false;
      return true;
    })
    .map(([key, value]) => ({
      name: key.replace(/_/g, ' '),
      abbrev: key,
      bits: 0,
      value: scrubMap ? scrubValue(value, scrubMap) : value,
      description: '',
    }));

  return {
    name: layer.name,
    layer: layer.layer || 0,
    fields,
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function buildTimeline(packets, actorMap, frames) {
  const firstTs = packets.length > 0 ? (packets[0].timestamp || 0) : 0;

  return packets.map((pkt, idx) => {
    const frame = frames[idx];
    const phase = inferPacketPhase(pkt);
    const label = frame.name;

    const tNs = Math.round(((pkt.timestamp || 0) - firstTs) * 1e9);

    const event = {
      id: `evt_${idx + 1}`,
      type: 'frame_tx',
      t_ns: tNs,
      frame_id: frame.id,
      annotation: {
        text: label,
        detail: pkt.summary || '',
      },
    };

    // Add state_after for significant TCP state changes
    const stateAfter = inferStateAfter(pkt, actorMap, phase);
    if (stateAfter) {
      event.state_after = stateAfter;
    }

    return event;
  });
}

/**
 * Infer TCP state changes for state_after on timeline events.
 */
function inferStateAfter(pkt, actorMap, phase) {
  const tcp = pkt.layers.find(l => l.name === 'TCP');
  if (!tcp) return null;

  const flags = tcp.fields.flag_names || '';
  const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (!ip) return null;

  const srcId = actorMap.get(ip.fields.src_ip);
  const dstId = actorMap.get(ip.fields.dst_ip);
  if (!srcId || !dstId) return null;

  // Only emit state_after for state-changing packets
  if (flags.includes('SYN') && !flags.includes('ACK')) {
    // SYN: sender -> SYN_SENT
    return [
      { actor_id: srcId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'SYN_SENT' } }] },
    ];
  }
  if (flags.includes('SYN') && flags.includes('ACK')) {
    // SYN-ACK: sender -> SYN_RECEIVED, receiver -> SYN_SENT (already)
    return [
      { actor_id: srcId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'SYN_RECEIVED' } }] },
    ];
  }
  if (flags.includes('ACK') && !flags.includes('SYN') && !flags.includes('FIN') && !flags.includes('RST')) {
    // Pure ACK after handshake
    if (phase === 'TCP Handshake') {
      return [
        { actor_id: srcId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'ESTABLISHED' } }] },
        { actor_id: dstId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'ESTABLISHED' } }] },
      ];
    }
    return null;
  }
  if (flags.includes('FIN')) {
    return [
      { actor_id: srcId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'FIN_WAIT_1' } }] },
    ];
  }
  if (flags.includes('RST')) {
    return [
      { actor_id: srcId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'CLOSED' } }] },
      { actor_id: dstId, layers: [{ layer: 4, name: 'TCP', state_fields: { tcp_state: 'CLOSED' } }] },
    ];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Packet labelling / phase inference (reused from pcapToScenario)
// ---------------------------------------------------------------------------

function inferPacketPhase(pkt) {
  const layerNames = pkt.layers.map(l => l.name);
  const tcp = pkt.layers.find(l => l.name === 'TCP');
  const flags = tcp?.fields.flag_names || '';

  if (layerNames.some(n => n.includes('BTH'))) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    const opName = bth?.fields.opcode_name || '';
    if (/write/i.test(opName)) return 'RDMA Write';
    if (/read/i.test(opName)) return 'RDMA Read';
    if (/send/i.test(opName)) return 'RDMA Send';
    if (/ack/i.test(opName)) return 'RDMA ACK';
    return 'RoCE';
  }

  if (flags.includes('SYN') && !flags.includes('ACK')) return 'TCP Handshake';
  if (flags.includes('SYN') && flags.includes('ACK')) return 'TCP Handshake';
  if (flags.includes('FIN')) return 'TCP Teardown';
  if (flags.includes('RST')) return 'TCP Reset';

  if (layerNames.includes('ARP')) return 'ARP';
  if (layerNames.includes('TCP')) return 'TCP Data';
  if (layerNames.includes('UDP')) return 'UDP';

  return 'Other';
}

function buildPacketLabel(pkt) {
  const tcp = pkt.layers.find(l => l.name === 'TCP');
  if (tcp) {
    const flags = tcp.fields.flag_names || '';
    if (flags) return `TCP [${flags}] ${tcp.fields.src_port}\u2192${tcp.fields.dst_port}`;
    return `TCP ${tcp.fields.src_port}\u2192${tcp.fields.dst_port}`;
  }

  const bth = pkt.layers.find(l => l.name.includes('BTH'));
  if (bth) return bth.fields.opcode_name || 'RoCE';

  const udp = pkt.layers.find(l => l.name === 'UDP');
  if (udp) return `UDP ${udp.fields.src_port}\u2192${udp.fields.dst_port}`;

  const arp = pkt.layers.find(l => l.name === 'ARP');
  if (arp) return `ARP ${arp.fields.opcode === '1' ? 'Request' : 'Reply'}`;

  const top = pkt.layers[pkt.layers.length - 1];
  return top?.name || 'Frame';
}

// ---------------------------------------------------------------------------
// Sensitive data helpers
// ---------------------------------------------------------------------------

function countSensitivePackets(packets) {
  let count = 0;
  for (const pkt of packets) {
    for (const layer of pkt.layers) {
      if (layer._sensitive) {
        count++;
        break;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Auto-title suggestion (exported for the modal to use)
// ---------------------------------------------------------------------------

/**
 * Suggest a title for the generated scenario based on packet contents.
 * @param {Array} packets
 * @returns {string}
 */
export function suggestTitle(packets) {
  const protocols = detectProtocols(packets);
  const dominantProto = protocols[0] || 'Captured Traffic';

  // Find the two most-active IPs
  const ipCounts = new Map();
  for (const pkt of packets) {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    if (ip) {
      ipCounts.set(ip.fields.src_ip, (ipCounts.get(ip.fields.src_ip) || 0) + 1);
      ipCounts.set(ip.fields.dst_ip, (ipCounts.get(ip.fields.dst_ip) || 0) + 1);
    }
  }

  const topIps = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([ip]) => ip);

  if (topIps.length === 2) {
    return `${dominantProto} Conversation: ${topIps[0]} \u2194 ${topIps[1]}`;
  }
  if (topIps.length === 1) {
    return `${dominantProto} Traffic from ${topIps[0]}`;
  }
  return `${dominantProto} Capture \u2014 ${packets.length} packets`;
}
