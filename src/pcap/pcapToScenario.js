/**
 * Convert a set of dissected packets (a conversation between two endpoints)
 * into a normalized scenario that the ProtoViz viewer can display.
 */

import { L_COLOR, PHASE_COLORS } from '../utils/constants';

export function packetsToScenario(packets, endpointA, endpointB) {
  const actors = buildActors(endpointA, endpointB);
  const osiLayers = buildOsiLayers(endpointA, endpointB);
  const timeline = buildTimeline(packets, endpointA, endpointB);

  const protocols = detectProtocols(packets);
  const meta = {
    title: `${endpointA} ↔ ${endpointB}`,
    protocol: protocols.join(', ') || 'Captured Traffic',
    description: `Conversation between ${endpointA} and ${endpointB} — ${packets.length} packets extracted from PCAP.`,
    difficulty: 'intermediate',
    tags: ['pcap', 'captured', ...protocols.map(p => p.toLowerCase())],
  };

  return { meta, actors, osi_layers: osiLayers, timeline };
}

/**
 * Extract the two IP endpoints from a right-clicked packet.
 */
export function getConversationEndpoints(packet) {
  const ip = packet.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (ip) {
    return { a: ip.fields.src_ip, b: ip.fields.dst_ip };
  }
  // Fallback to MAC
  const eth = packet.layers.find(l => l.name === 'Ethernet');
  if (eth) {
    return { a: eth.fields.src_mac, b: eth.fields.dst_mac };
  }
  return null;
}

/**
 * Filter packets to only those between two endpoints.
 */
export function filterConversation(packets, endpointA, endpointB) {
  return packets.filter(pkt => {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    if (ip) {
      const { src_ip, dst_ip } = ip.fields;
      return (src_ip === endpointA && dst_ip === endpointB) ||
             (src_ip === endpointB && dst_ip === endpointA);
    }
    const eth = pkt.layers.find(l => l.name === 'Ethernet');
    if (eth) {
      const { src_mac, dst_mac } = eth.fields;
      return (src_mac === endpointA && dst_mac === endpointB) ||
             (src_mac === endpointB && dst_mac === endpointA);
    }
    return false;
  });
}

function buildActors(endpointA, endpointB) {
  return [
    { id: 'initiator', label: endpointA, type: 'host', ip: endpointA, pos: 'left' },
    { id: 'target', label: endpointB, type: 'host', ip: endpointB, pos: 'right' },
  ];
}

function buildOsiLayers(endpointA, endpointB) {
  const makeLayers = () => [
    { layer: 4, name: 'Transport', color: L_COLOR[4], fields: {} },
    { layer: 3, name: 'Network', color: L_COLOR[3], fields: {} },
    { layer: 2, name: 'Data Link', color: L_COLOR[2], fields: {} },
    { layer: 1, name: 'Physical', color: L_COLOR[1], fields: { link: 'UP' } },
  ];
  return {
    initiator: makeLayers(),
    target: makeLayers(),
  };
}

function buildTimeline(packets, endpointA, endpointB) {
  return packets.map((pkt, idx) => {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    const srcIp = ip?.fields.src_ip;
    const isFromA = srcIp === endpointA;

    const phase = inferPacketPhase(pkt);
    const color = PHASE_COLORS[phase] || '#475569';
    const label = buildPacketLabel(pkt);

    const event = {
      id: `pkt_${pkt.index}`,
      t: idx,
      phase,
      type: 'frame_tx',
      label,
      detail: pkt.summary || '',
      color,
      from: isFromA ? 'initiator' : 'target',
      to: isFromA ? 'target' : 'initiator',
      via: [],
      frame: {
        name: label,
        bytes: pkt.capturedLen,
        headers: pkt.layers
          .filter(l => l.name !== 'Ethernet') // Skip L2 for cleaner display
          .map(layer => ({
            name: layer.name,
            layer: layer.layer,
            fields: Object.entries(layer.fields).map(([k, v]) => ({
              name: k.replace(/_/g, ' '),
              abbrev: k,
              bits: 0,
              value: v,
              desc: '',
            })),
          })),
      },
    };

    return event;
  });
}

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
    if (flags) return `TCP [${flags}] ${tcp.fields.src_port}→${tcp.fields.dst_port}`;
    return `TCP ${tcp.fields.src_port}→${tcp.fields.dst_port}`;
  }

  const bth = pkt.layers.find(l => l.name.includes('BTH'));
  if (bth) return bth.fields.opcode_name || 'RoCE';

  const udp = pkt.layers.find(l => l.name === 'UDP');
  if (udp) return `UDP ${udp.fields.src_port}→${udp.fields.dst_port}`;

  const arp = pkt.layers.find(l => l.name === 'ARP');
  if (arp) return `ARP ${arp.fields.opcode === '1' ? 'Request' : 'Reply'}`;

  // Use highest-layer protocol name
  const top = pkt.layers[pkt.layers.length - 1];
  return top?.name || 'Frame';
}

function detectProtocols(packets) {
  const protos = new Set();
  for (const pkt of packets) {
    for (const l of pkt.layers) {
      if (l.name.includes('BTH')) { protos.add('RoCEv2'); continue; }
      if (l.name === 'TCP') protos.add('TCP');
      if (l.name === 'UDP') protos.add('UDP');
      if (l.name === 'ARP') protos.add('ARP');
    }
  }
  return [...protos];
}
