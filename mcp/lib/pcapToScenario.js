/**
 * Self-contained PCAP/tshark-JSON to ProtoViz scenario converter.
 *
 * Bundles all parsing, dissection, and scenario generation logic so the
 * MCP server can work independently of the browser-side src/ tree.
 */

import yaml from 'js-yaml';

// ─── Constants ──────────────────────────────────────────────────

const L_COLOR = {
  7: '#7c3aed', 6: '#6d28d9', 5: '#1d4ed8',
  4: '#0369a1', 3: '#0f766e', 2: '#15803d', 1: '#92400e',
};

const PHASE_COLORS = {
  'TCP Handshake': '#0f766e', 'TCP Data': '#0369a1',
  'TCP Teardown': '#64748b', 'TCP Reset': '#dc2626',
  'UDP': '#1e40af', 'RoCE': '#7c3aed',
  'RDMA Write': '#991b1b', 'RDMA Read': '#6b21a8',
  'RDMA Send': '#1d4ed8', 'RDMA ACK': '#475569',
  'ARP': '#b45309', 'Other': '#475569',
};

// ─── PCAP Binary Parser ─────────────────────────────────────────

const PCAP_MAGIC_LE = 0xa1b2c3d4;
const PCAP_MAGIC_BE = 0xd4c3b2a1;
const PCAPNG_SHB_MAGIC = 0x0a0d0d0a;
const PCAPNG_BYTE_ORDER_MAGIC = 0x1a2b3c4d;

function parsePcap(arrayBuffer, maxPackets = 500) {
  if (arrayBuffer.byteLength < 24) {
    throw new Error('File too small to be a valid capture file');
  }
  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);

  if (magic === PCAPNG_SHB_MAGIC) {
    return parsePcapng(arrayBuffer, view, maxPackets);
  }
  if (magic === PCAP_MAGIC_LE || magic === PCAP_MAGIC_BE) {
    return parseLegacyPcap(arrayBuffer, view, magic === PCAP_MAGIC_LE, maxPackets);
  }
  throw new Error('Not a valid capture file. Supported formats: PCAP, pcapng.');
}

function parseLegacyPcap(arrayBuffer, view, le, maxPackets) {
  const linkType = view.getUint32(20, le);
  if (linkType !== 1) {
    throw new Error(`Unsupported link type: ${linkType}. Only Ethernet (1) is supported.`);
  }
  const packets = [];
  let offset = 24;
  while (offset + 16 <= arrayBuffer.byteLength && packets.length < maxPackets) {
    const tsSec = view.getUint32(offset, le);
    const tsUsec = view.getUint32(offset + 4, le);
    const capturedLen = view.getUint32(offset + 8, le);
    const originalLen = view.getUint32(offset + 12, le);
    offset += 16;
    if (offset + capturedLen > arrayBuffer.byteLength) break;
    const data = new Uint8Array(arrayBuffer, offset, capturedLen);
    packets.push({ index: packets.length, timestamp: tsSec + tsUsec / 1e6, capturedLen, originalLen, data });
    offset += capturedLen;
  }
  return { packets };
}

function parsePcapng(arrayBuffer, view, maxPackets) {
  const len = arrayBuffer.byteLength;
  let offset = 0;
  let le = true;
  const interfaces = [];
  const packets = [];

  while (offset + 8 <= len && packets.length < maxPackets) {
    const blockType = view.getUint32(offset, le);
    const blockTotalLen = view.getUint32(offset + 4, le);
    if (blockTotalLen < 12 || offset + blockTotalLen > len) break;

    if (blockType === 0x0a0d0d0a) {
      // Section Header Block
      const bom = view.getUint32(offset + 12, true);
      le = bom === PCAPNG_BYTE_ORDER_MAGIC;
      if (!le) {
        const bomBE = view.getUint32(offset + 12, false);
        if (bomBE !== PCAPNG_BYTE_ORDER_MAGIC) le = true;
      }
    } else if (blockType === 0x00000001) {
      // Interface Description Block
      const linkType = view.getUint16(offset + 8, le);
      let tsResol = 6;
      let optOffset = offset + 16;
      const optEnd = offset + blockTotalLen - 4;
      while (optOffset + 4 <= optEnd) {
        const optCode = view.getUint16(optOffset, le);
        const optLen = view.getUint16(optOffset + 2, le);
        if (optCode === 0) break;
        if (optCode === 9 && optLen >= 1) {
          const resol = view.getUint8(optOffset + 4);
          tsResol = (resol & 0x80) ? (resol & 0x7f) : resol;
        }
        optOffset += 4 + Math.ceil(optLen / 4) * 4;
      }
      interfaces.push({ linkType, tsResol });
    } else if (blockType === 0x00000006) {
      // Enhanced Packet Block
      const interfaceId = view.getUint32(offset + 8, le);
      const tsHigh = view.getUint32(offset + 12, le);
      const tsLow = view.getUint32(offset + 16, le);
      const capturedLen = view.getUint32(offset + 20, le);
      const originalLen = view.getUint32(offset + 24, le);
      const dataOffset = offset + 28;
      const iface = interfaces[interfaceId] || interfaces[0];
      if (iface && iface.linkType === 1 && dataOffset + capturedLen <= arrayBuffer.byteLength) {
        const tsRaw = tsHigh * 0x100000000 + tsLow;
        const timestamp = tsRaw / Math.pow(10, iface.tsResol);
        const data = new Uint8Array(arrayBuffer, dataOffset, capturedLen);
        packets.push({ index: packets.length, timestamp, capturedLen, originalLen, data });
      }
    } else if (blockType === 0x00000003) {
      // Simple Packet Block
      const originalLen = view.getUint32(offset + 8, le);
      const capturedLen = blockTotalLen - 16;
      const dataOffset = offset + 12;
      const iface = interfaces[0];
      if (iface && iface.linkType === 1 && dataOffset + capturedLen <= arrayBuffer.byteLength && capturedLen > 0) {
        const data = new Uint8Array(arrayBuffer, dataOffset, capturedLen);
        packets.push({ index: packets.length, timestamp: 0, capturedLen, originalLen, data });
      }
    }
    offset += blockTotalLen;
  }

  if (packets.length === 0) {
    throw new Error('No packets found in pcapng file');
  }
  const hasEthernet = interfaces.some(i => i.linkType === 1);
  if (!hasEthernet && interfaces.length > 0) {
    throw new Error(`Unsupported link type(s): ${interfaces.map(i => i.linkType).join(', ')}. Only Ethernet (1) is supported.`);
  }
  return { packets };
}

// ─── tshark JSON Parser ─────────────────────────────────────────

const TSHARK_LAYER_MAP = {
  eth: 2, arp: 2, vlan: 2,
  ip: 3, ipv6: 3, icmp: 3, icmpv6: 3,
  tcp: 4, udp: 4, sctp: 4,
  infiniband: 4, bth: 4, grh: 3, reth: 4, aeth: 4,
  rdmap: 5, ddp: 5, mpa: 5, iwarp: 5,
  nvme: 5, 'nvme-rdma': 5, 'nvme-tcp': 5, iscsi: 5,
  dns: 7, http: 7, http2: 7, tls: 6, ssl: 6,
};

const TCP_FLAG_FIELDS = {
  'tcp.flags.fin': 'FIN', 'tcp.flags.syn': 'SYN', 'tcp.flags.reset': 'RST',
  'tcp.flags.push': 'PSH', 'tcp.flags.ack': 'ACK', 'tcp.flags.urg': 'URG',
  'tcp.flags.ece': 'ECE', 'tcp.flags.cwr': 'CWR',
};

const BTH_OPCODE_NAMES = {
  0: 'RC Send First', 1: 'RC Send Middle', 2: 'RC Send Last',
  3: 'RC Send Last Immediate', 4: 'RC Send Only', 5: 'RC Send Only Immediate',
  6: 'RC RDMA Write First', 7: 'RC RDMA Write Middle', 8: 'RC RDMA Write Last',
  9: 'RC RDMA Write Last Immediate', 10: 'RC RDMA Write Only',
  11: 'RC RDMA Write Only Immediate', 12: 'RC RDMA Read Request',
  13: 'RC RDMA Read Response First', 14: 'RC RDMA Read Response Middle',
  15: 'RC RDMA Read Response Last', 16: 'RC RDMA Read Response Only',
  17: 'RC Acknowledge', 18: 'RC Atomic Acknowledge',
  19: 'RC Compare & Swap', 20: 'RC Fetch & Add',
};

function parseTsharkJson(jsonText) {
  let raw;
  try { raw = JSON.parse(jsonText); } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(raw)) throw new Error('Expected a JSON array (tshark -T json output)');
  if (raw.length === 0) throw new Error('No packets found in JSON');

  const first = raw[0];
  if (!first._source?.layers && !first.layers) {
    throw new Error('Unrecognized JSON format. Expected tshark -T json output.');
  }

  const packets = raw.map((entry, index) => {
    const tsharkLayers = entry._source?.layers || entry.layers || {};
    return convertTsharkPacket(tsharkLayers, index);
  });
  return { packets };
}

function convertTsharkPacket(tsharkLayers, index) {
  const layers = [];
  let timestamp = 0;
  let capturedLen = 0;
  let originalLen = 0;
  const summaryParts = [];

  const frame = tsharkLayers.frame;
  if (frame) {
    timestamp = parseFloat(frame['frame.time_epoch'] || '0');
    capturedLen = parseInt(frame['frame.cap_len'] || frame['frame.len'] || '0', 10);
    originalLen = parseInt(frame['frame.len'] || '0', 10);
  }

  for (const [proto, fields] of Object.entries(tsharkLayers)) {
    if (proto === 'frame' || proto === 'frame_raw' || proto.endsWith('_raw')) continue;
    if (typeof fields !== 'object' || fields === null) continue;

    const flatFields = {};
    flattenFields(fields, proto, flatFields);
    const layerNum = TSHARK_LAYER_MAP[proto] || guessTsharkLayerNum(proto);
    const converted = convertTsharkLayer(proto, flatFields, layerNum, summaryParts);
    if (converted) layers.push(converted);
  }

  const summary = summaryParts.join(' | ') || layers.map(l => l.name).join(' -> ');

  return { index, timestamp, capturedLen, originalLen, layers, summary, data: new Uint8Array(0) };
}

function guessTsharkLayerNum(proto) {
  if (/^eth|^mac|^llc|^stp|^lldp|^cdp/.test(proto)) return 2;
  if (/^ip|^igmp|^ospf|^bgp|^rip/.test(proto)) return 3;
  if (/^tcp|^udp|^sctp|^dccp/.test(proto)) return 4;
  return 5;
}

function convertTsharkLayer(proto, flatFields, layerNum, summaryParts) {
  switch (proto) {
    case 'eth':
      return { layer: 2, name: 'Ethernet', fields: { dst_mac: flatFields['eth.dst'] || '', src_mac: flatFields['eth.src'] || '', ethertype: flatFields['eth.type'] || '' } };
    case 'ip':
      summaryParts.push(`${flatFields['ip.src'] || '?'} -> ${flatFields['ip.dst'] || '?'}`);
      return { layer: 3, name: 'IPv4', fields: { src_ip: flatFields['ip.src'] || '', dst_ip: flatFields['ip.dst'] || '', ttl: flatFields['ip.ttl'] || '', protocol: flatFields['ip.proto'] || '' } };
    case 'ipv6':
      summaryParts.push(`${flatFields['ipv6.src'] || '?'} -> ${flatFields['ipv6.dst'] || '?'}`);
      return { layer: 3, name: 'IPv6', fields: { src_ip: flatFields['ipv6.src'] || '', dst_ip: flatFields['ipv6.dst'] || '', hop_limit: flatFields['ipv6.hlim'] || '' } };
    case 'tcp': {
      const flagNames = [];
      for (const [fk, fn] of Object.entries(TCP_FLAG_FIELDS)) {
        if (flatFields[fk] === '1') flagNames.push(fn);
      }
      const flagStr = flagNames.join(',');
      summaryParts.push(`TCP ${flatFields['tcp.srcport'] || '?'}->${flatFields['tcp.dstport'] || '?'} [${flagStr}]`);
      return { layer: 4, name: 'TCP', fields: {
        src_port: parseInt(flatFields['tcp.srcport'] || '0', 10),
        dst_port: parseInt(flatFields['tcp.dstport'] || '0', 10),
        seq_num: parseInt(flatFields['tcp.seq'] || flatFields['tcp.seq_raw'] || '0', 10),
        ack_num: parseInt(flatFields['tcp.ack'] || flatFields['tcp.ack_raw'] || '0', 10),
        flags: flatFields['tcp.flags'] || '', flag_names: flagStr,
        window_size: parseInt(flatFields['tcp.window_size_value'] || flatFields['tcp.window_size'] || '0', 10),
      }};
    }
    case 'udp':
      summaryParts.push(`UDP ${flatFields['udp.srcport'] || '?'}->${flatFields['udp.dstport'] || '?'}`);
      return { layer: 4, name: 'UDP', fields: {
        src_port: parseInt(flatFields['udp.srcport'] || '0', 10),
        dst_port: parseInt(flatFields['udp.dstport'] || '0', 10),
        length: parseInt(flatFields['udp.length'] || '0', 10),
      }};
    case 'arp':
      summaryParts.push(`ARP ${flatFields['arp.opcode'] === '1' ? 'Request' : 'Reply'}`);
      return { layer: 2, name: 'ARP', fields: {
        opcode: flatFields['arp.opcode'] || '', sender_mac: flatFields['arp.src.hw_mac'] || '',
        sender_ip: flatFields['arp.src.proto_ipv4'] || '', target_mac: flatFields['arp.dst.hw_mac'] || '',
        target_ip: flatFields['arp.dst.proto_ipv4'] || '',
      }};
    case 'infiniband':
    case 'bth': {
      const opcode = parseInt(flatFields['infiniband.bth.opcode'] || flatFields['bth.opcode'] || '0', 10);
      const opcodeName = BTH_OPCODE_NAMES[opcode] || `Opcode ${opcode}`;
      const destQp = parseInt(flatFields['infiniband.bth.destqp'] || flatFields['bth.destqp'] || '0', 10);
      const psn = parseInt(flatFields['infiniband.bth.psn'] || flatFields['bth.psn'] || '0', 10);
      summaryParts.push(`RoCEv2 ${opcodeName} QP=${destQp} PSN=${psn}`);
      return { layer: 4, name: `BTH (${opcodeName})`, fields: { opcode, opcode_name: opcodeName, dest_qp: destQp, psn } };
    }
    default: {
      const selectedFields = {};
      let count = 0;
      for (const [k, v] of Object.entries(flatFields)) {
        if (count >= 20) break;
        const shortKey = k.startsWith(proto + '.') ? k.slice(proto.length + 1) : k;
        selectedFields[shortKey] = v;
        count++;
      }
      if (Object.keys(selectedFields).length === 0) return null;
      return { layer: layerNum, name: proto.toUpperCase(), fields: selectedFields };
    }
  }
}

function flattenFields(obj, prefix, result) {
  if (typeof obj !== 'object' || obj === null) return;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenFields(value, key, result);
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      result[key] = value.join(', ');
    }
  }
}

// ─── Binary Dissectors (Ethernet, IPv4, TCP, UDP, RoCE) ────────

const ETHERTYPES = { 0x0800: 'IPv4', 0x0806: 'ARP', 0x86dd: 'IPv6', 0x8915: 'RoCEv1' };
const IP_PROTOCOLS = { 1: 'ICMP', 6: 'TCP', 17: 'UDP', 47: 'GRE' };
const ROCE_V2_PORT = 4791;

const BTH_OPCODES = {
  0x00: 'RC Send First', 0x01: 'RC Send Middle', 0x02: 'RC Send Last',
  0x03: 'RC Send Last w/ Immediate', 0x04: 'RC Send Only', 0x05: 'RC Send Only w/ Immediate',
  0x06: 'RC RDMA Write First', 0x07: 'RC RDMA Write Middle', 0x08: 'RC RDMA Write Last',
  0x09: 'RC RDMA Write Last w/ Immediate', 0x0a: 'RC RDMA Write Only',
  0x0b: 'RC RDMA Write Only w/ Immediate', 0x0c: 'RC RDMA Read Request',
  0x0d: 'RC RDMA Read Response First', 0x0e: 'RC RDMA Read Response Middle',
  0x0f: 'RC RDMA Read Response Last', 0x10: 'RC RDMA Read Response Only',
  0x11: 'RC Acknowledge', 0x12: 'RC Atomic Acknowledge',
  0x13: 'RC Compare & Swap', 0x14: 'RC Fetch & Add',
};
const RETH_OPCODES = [0x06, 0x0a, 0x0b, 0x0c];
const AETH_OPCODES = [0x0d, 0x0f, 0x10, 0x11, 0x12];
const AETH_TYPES = { 0: 'ACK', 1: 'RNR NAK', 2: 'Reserved', 3: 'NAK' };

function formatMac(data, offset) {
  return Array.from(data.slice(offset, offset + 6))
    .map(b => b.toString(16).padStart(2, '0')).join(':');
}
function formatIp(data, offset) {
  return `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
}
function readUint32(data, offset) {
  return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}

function dissectEthernet(data, offset = 0) {
  if (data.length < offset + 14) return null;
  const dstMac = formatMac(data, offset);
  const srcMac = formatMac(data, offset + 6);
  const ethertype = (data[offset + 12] << 8) | data[offset + 13];
  return { layer: 2, name: 'Ethernet II', fields: { dst_mac: dstMac, src_mac: srcMac, ethertype: `0x${ethertype.toString(16).padStart(4, '0')}`, ethertype_name: ETHERTYPES[ethertype] || 'Unknown' }, nextOffset: offset + 14, nextProtocol: ethertype };
}

function dissectIPv4(data, offset) {
  if (data.length < offset + 20) return null;
  const versionIhl = data[offset];
  const version = versionIhl >> 4;
  const ihl = (versionIhl & 0x0f) * 4;
  if (version !== 4) return null;
  const dscp = data[offset + 1] >> 2;
  const ecn = data[offset + 1] & 0x03;
  const totalLength = (data[offset + 2] << 8) | data[offset + 3];
  const ttl = data[offset + 8];
  const protocol = data[offset + 9];
  const srcIp = formatIp(data, offset + 12);
  const dstIp = formatIp(data, offset + 16);
  return { layer: 3, name: 'IPv4', fields: { src_ip: srcIp, dst_ip: dstIp, ttl, protocol, protocol_name: IP_PROTOCOLS[protocol] || 'Unknown', dscp, ecn, total_length: totalLength }, nextOffset: offset + ihl, nextProtocol: protocol };
}

function dissectTCP(data, offset) {
  if (data.length < offset + 20) return null;
  const srcPort = (data[offset] << 8) | data[offset + 1];
  const dstPort = (data[offset + 2] << 8) | data[offset + 3];
  const seqNum = readUint32(data, offset + 4);
  const ackNum = readUint32(data, offset + 8);
  const dataOffset = (data[offset + 12] >> 4) * 4;
  const flags = data[offset + 13];
  const windowSize = (data[offset + 14] << 8) | data[offset + 15];
  const flagNames = [];
  if (flags & 0x01) flagNames.push('FIN');
  if (flags & 0x02) flagNames.push('SYN');
  if (flags & 0x04) flagNames.push('RST');
  if (flags & 0x08) flagNames.push('PSH');
  if (flags & 0x10) flagNames.push('ACK');
  if (flags & 0x20) flagNames.push('URG');
  if (flags & 0x40) flagNames.push('ECE');
  if (flags & 0x80) flagNames.push('CWR');
  return { layer: 4, name: 'TCP', fields: { src_port: srcPort, dst_port: dstPort, seq_num: seqNum, ack_num: ackNum, data_offset: dataOffset, flags: `0x${flags.toString(16).padStart(2, '0')}`, flag_names: flagNames.join(','), window_size: windowSize }, nextOffset: offset + dataOffset };
}

function dissectUDP(data, offset) {
  if (data.length < offset + 8) return null;
  const srcPort = (data[offset] << 8) | data[offset + 1];
  const dstPort = (data[offset + 2] << 8) | data[offset + 3];
  const length = (data[offset + 4] << 8) | data[offset + 5];
  return { layer: 4, name: 'UDP', fields: { src_port: srcPort, dst_port: dstPort, length }, nextOffset: offset + 8 };
}

function dissectBTH(data, offset) {
  if (data.length < offset + 12) return null;
  const opcode = data[offset];
  const pkey = (data[offset + 2] << 8) | data[offset + 3];
  const destQP = ((data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7]) & 0x00ffffff;
  const ackReq = !!(data[offset + 8] & 0x80);
  const psn = ((data[offset + 9] << 16) | (data[offset + 10] << 8) | data[offset + 11]) & 0x00ffffff;
  const opName = BTH_OPCODES[opcode] || `Unknown(0x${opcode.toString(16)})`;
  return { layer: 5, name: `BTH (${opName})`, fields: { opcode: `0x${opcode.toString(16).padStart(2, '0')}`, opcode_name: opName, pkey: `0x${pkey.toString(16).padStart(4, '0')}`, dest_qp: destQP, ack_req: ackReq, psn }, nextOffset: offset + 12, opcodeNum: opcode };
}

function dissectRETH(data, offset) {
  if (data.length < offset + 16) return null;
  const vaHigh = readUint32(data, offset);
  const vaLow = readUint32(data, offset + 4);
  const rkey = readUint32(data, offset + 8);
  const dmaLength = readUint32(data, offset + 12);
  return { layer: 5, name: 'RETH', fields: { virtual_address: `0x${vaHigh.toString(16).padStart(8, '0')}${vaLow.toString(16).padStart(8, '0')}`, rkey: `0x${rkey.toString(16).padStart(8, '0')}`, dma_length: dmaLength }, nextOffset: offset + 16 };
}

function dissectAETH(data, offset) {
  if (data.length < offset + 4) return null;
  const syndrome = data[offset];
  const msn = ((data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) & 0x00ffffff;
  const ackType = (syndrome >> 5) & 0x07;
  return { layer: 5, name: 'AETH', fields: { syndrome: `0x${syndrome.toString(16).padStart(2, '0')}`, ack_type: AETH_TYPES[ackType] || 'Unknown', credit_count: syndrome & 0x1f, msn }, nextOffset: offset + 4 };
}

// ─── Full binary dissection pipeline ────────────────────────────

function dissectPacket(packet) {
  const { data } = packet;
  const layers = [];
  let summary = '';

  const eth = dissectEthernet(data);
  if (!eth) return { layers, summary: 'Truncated Ethernet' };
  layers.push(eth);

  if (eth.nextProtocol === 0x0800) {
    const ip = dissectIPv4(data, eth.nextOffset);
    if (!ip) return { layers, summary: `Truncated IPv4` };
    layers.push(ip);
    summary = `${ip.fields.src_ip} -> ${ip.fields.dst_ip}`;

    if (ip.nextProtocol === 17) {
      const udp = dissectUDP(data, ip.nextOffset);
      if (udp) {
        layers.push(udp);
        if (udp.fields.dst_port === ROCE_V2_PORT || udp.fields.src_port === ROCE_V2_PORT) {
          const bth = dissectBTH(data, udp.nextOffset);
          if (bth) {
            layers.push(bth);
            summary += ` | RoCEv2 ${bth.fields.opcode_name} QP=${bth.fields.dest_qp} PSN=${bth.fields.psn}`;
            let nextOff = bth.nextOffset;
            if (RETH_OPCODES.includes(bth.opcodeNum)) {
              const reth = dissectRETH(data, nextOff);
              if (reth) { layers.push(reth); nextOff = reth.nextOffset; }
            }
            if (AETH_OPCODES.includes(bth.opcodeNum)) {
              const aeth = dissectAETH(data, nextOff);
              if (aeth) layers.push(aeth);
            }
          }
        } else {
          summary += ` | UDP ${udp.fields.src_port}->${udp.fields.dst_port}`;
        }
      }
    } else if (ip.nextProtocol === 6) {
      const tcp = dissectTCP(data, ip.nextOffset);
      if (tcp) {
        layers.push(tcp);
        summary += ` | TCP ${tcp.fields.src_port}->${tcp.fields.dst_port} [${tcp.fields.flag_names}]`;
      }
    } else {
      summary += ` | ${ip.fields.protocol_name}`;
    }
  } else if (eth.nextProtocol === 0x0806) {
    summary = `ARP ${eth.fields.src_mac} -> ${eth.fields.dst_mac}`;
  } else {
    summary = `${eth.fields.ethertype_name} (${eth.fields.ethertype})`;
  }

  return { layers, summary };
}

// ─── Scrubbing / Anonymization ──────────────────────────────────

function buildScrubMaps(dissectedPackets) {
  const ipSet = new Set();
  const macSet = new Set();

  for (const pkt of dissectedPackets) {
    for (const layer of pkt.layers) {
      if (layer.fields.src_ip) ipSet.add(layer.fields.src_ip);
      if (layer.fields.dst_ip) ipSet.add(layer.fields.dst_ip);
      if (layer.fields.src_mac) macSet.add(layer.fields.src_mac);
      if (layer.fields.dst_mac) macSet.add(layer.fields.dst_mac);
    }
  }

  const ipMap = {};
  let ipIdx = 1;
  for (const ip of ipSet) {
    ipMap[ip] = `10.0.0.${ipIdx}`;
    ipIdx++;
  }

  const macMap = {};
  let macIdx = 1;
  for (const mac of macSet) {
    macMap[mac] = `00:00:5e:00:00:${macIdx.toString(16).padStart(2, '0')}`;
    macIdx++;
  }

  return { ipMap, macMap };
}

function scrubValue(val, ipMap, macMap) {
  if (typeof val !== 'string') return val;
  let result = val;
  for (const [real, anon] of Object.entries(ipMap)) {
    result = result.split(real).join(anon);
  }
  for (const [real, anon] of Object.entries(macMap)) {
    result = result.split(real).join(anon);
  }
  return result;
}

function scrubFields(fields, ipMap, macMap) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = scrubValue(v, ipMap, macMap);
  }
  return out;
}

function scrubPackets(dissectedPackets, ipMap, macMap) {
  return dissectedPackets.map(pkt => ({
    ...pkt,
    summary: scrubValue(pkt.summary, ipMap, macMap),
    layers: pkt.layers.map(layer => ({
      ...layer,
      name: scrubValue(layer.name, ipMap, macMap),
      fields: scrubFields(layer.fields, ipMap, macMap),
    })),
  }));
}

// ─── Scenario Generation ────────────────────────────────────────

function detectEndpoints(dissectedPackets) {
  // Find the two most common IP endpoints
  const ipCounts = {};
  for (const pkt of dissectedPackets) {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    if (ip) {
      ipCounts[ip.fields.src_ip] = (ipCounts[ip.fields.src_ip] || 0) + 1;
      ipCounts[ip.fields.dst_ip] = (ipCounts[ip.fields.dst_ip] || 0) + 1;
    }
  }
  const sorted = Object.entries(ipCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length >= 2) return { a: sorted[0][0], b: sorted[1][0] };
  if (sorted.length === 1) return { a: sorted[0][0], b: 'unknown' };

  // Fallback to MAC
  const macCounts = {};
  for (const pkt of dissectedPackets) {
    const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
    if (eth) {
      macCounts[eth.fields.src_mac] = (macCounts[eth.fields.src_mac] || 0) + 1;
      macCounts[eth.fields.dst_mac] = (macCounts[eth.fields.dst_mac] || 0) + 1;
    }
  }
  const macSorted = Object.entries(macCounts).sort((a, b) => b[1] - a[1]);
  if (macSorted.length >= 2) return { a: macSorted[0][0], b: macSorted[1][0] };
  return { a: 'host_a', b: 'host_b' };
}

function detectActorMacs(dissectedPackets, endpointA) {
  // Find the MAC associated with endpointA
  for (const pkt of dissectedPackets) {
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
    if (ip && eth && ip.fields.src_ip === endpointA) {
      return { macA: eth.fields.src_mac, macB: eth.fields.dst_mac };
    }
  }
  return { macA: '', macB: '' };
}

function detectProtocols(dissectedPackets) {
  const protos = new Set();
  for (const pkt of dissectedPackets) {
    for (const l of pkt.layers) {
      if (l.name.includes('BTH')) { protos.add('RoCEv2'); continue; }
      if (l.name === 'TCP') protos.add('TCP');
      if (l.name === 'UDP') protos.add('UDP');
      if (l.name === 'ARP') protos.add('ARP');
    }
  }
  return [...protos];
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
  if (flags.includes('SYN')) return 'TCP Handshake';
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
    if (flags) return `TCP [${flags}] ${tcp.fields.src_port}->${tcp.fields.dst_port}`;
    return `TCP ${tcp.fields.src_port}->${tcp.fields.dst_port}`;
  }
  const bth = pkt.layers.find(l => l.name.includes('BTH'));
  if (bth) return bth.fields.opcode_name || 'RoCE';
  const udp = pkt.layers.find(l => l.name === 'UDP');
  if (udp) return `UDP ${udp.fields.src_port}->${udp.fields.dst_port}`;
  const arp = pkt.layers.find(l => l.name === 'ARP');
  if (arp) return `ARP ${arp.fields.opcode === '1' ? 'Request' : 'Reply'}`;
  const top = pkt.layers[pkt.layers.length - 1];
  return top?.name || 'Frame';
}

function isFromEndpointA(pkt, endpointA) {
  const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
  if (ip) return ip.fields.src_ip === endpointA;
  const eth = pkt.layers.find(l => l.name === 'Ethernet II' || l.name === 'Ethernet');
  if (eth) return eth.fields.src_mac === endpointA;
  return true;
}

function generateScenario(dissectedPackets, options = {}) {
  const {
    title: customTitle,
    scrub = true,
  } = options;

  let packets = dissectedPackets;
  const endpoints = detectEndpoints(packets);
  const protocols = detectProtocols(packets);

  // Build scrub maps before scrubbing so actor detection works on real data
  let ipMap = {};
  let macMap = {};
  if (scrub) {
    const maps = buildScrubMaps(packets);
    ipMap = maps.ipMap;
    macMap = maps.macMap;
  }

  // Detect actors before scrubbing
  const macs = detectActorMacs(packets, endpoints.a);

  // Apply scrubbing
  if (scrub) {
    packets = scrubPackets(packets, ipMap, macMap);
  }

  // Post-scrub endpoints
  const epA = scrub ? (ipMap[endpoints.a] || endpoints.a) : endpoints.a;
  const epB = scrub ? (ipMap[endpoints.b] || endpoints.b) : endpoints.b;
  const macA = scrub ? (macMap[macs.macA] || macs.macA) : macs.macA;
  const macB = scrub ? (macMap[macs.macB] || macs.macB) : macs.macB;

  // Meta
  const scenarioTitle = customTitle || `${protocols.join('/') || 'Captured'} Traffic: ${epA} <-> ${epB}`;
  const slugBase = scenarioTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const meta = {
    id: slugBase,
    title: scenarioTitle,
    protocol: protocols.join(', ') || 'Captured Traffic',
    protocol_family: protocols.includes('RoCEv2') ? 'RDMA' : protocols.includes('TCP') ? 'TCP/IP' : 'IP',
    version: '1.0.0',
    description: `Conversation between ${epA} and ${epB} — ${packets.length} packets extracted from packet capture.`,
    difficulty: 'intermediate',
    authors: [{ name: 'Generated by ProtoViz MCP', org: 'proto-viz', github: 'proto-viz' }],
    created: new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    tags: ['pcap', 'captured', ...protocols.map(p => p.toLowerCase())],
  };

  // Topology
  const topology = {
    actors: [
      { id: 'initiator', type: 'host', label: `Host A (${epA})`, ip: epA, mac: macA, position: 'left' },
      { id: 'target', type: 'host', label: `Host B (${epB})`, ip: epB, mac: macB, position: 'right' },
    ],
    links: [
      { id: 'link_a_b', from: 'initiator', to: 'target', speed_gbps: 10 },
    ],
  };

  // OSI Layers
  const makeLayers = () => [
    { layer: 4, name: 'Transport', components: ['TCP', 'UDP'], state_schema: {} },
    { layer: 3, name: 'Network', components: ['IPv4'], state_schema: {} },
    { layer: 2, name: 'Data Link', components: ['Ethernet'], state_schema: {} },
    { layer: 1, name: 'Physical', components: ['10GbE'], state_schema: {} },
  ];
  const osi_layers = {
    initiator: makeLayers(),
    target: makeLayers(),
  };

  // Frames
  const frames = packets.map((pkt, idx) => {
    const fromA = isFromEndpointA(pkt, epA);
    const label = buildPacketLabel(pkt);
    const phase = inferPacketPhase(pkt);
    const color = PHASE_COLORS[phase] || '#475569';

    return {
      id: `frame_${idx}`,
      name: label,
      description: pkt.summary || '',
      from: fromA ? 'initiator' : 'target',
      to: fromA ? 'target' : 'initiator',
      via: [],
      total_bytes: pkt.capturedLen,
      color,
      headers: pkt.layers
        .filter(l => l.name !== 'Ethernet II' && l.name !== 'Ethernet')
        .map(layer => ({
          name: layer.name,
          layer: layer.layer,
          fields: Object.entries(layer.fields).map(([k, v]) => ({
            name: k.replace(/_/g, ' '),
            abbrev: k,
            bits: 0,
            value: v,
            description: '',
          })),
        })),
    };
  });

  // Timeline
  const baseTimestamp = packets.length > 0 ? packets[0].timestamp : 0;
  const timeline = packets.map((pkt, idx) => {
    const phase = inferPacketPhase(pkt);
    const relativeNs = Math.round((pkt.timestamp - baseTimestamp) * 1e9);

    return {
      id: `evt_${idx}`,
      type: 'frame_tx',
      t_ns: relativeNs >= 0 ? relativeNs : idx * 1000,
      frame_id: `frame_${idx}`,
      annotation: {
        text: buildPacketLabel(pkt),
        detail: pkt.summary || '',
      },
    };
  });

  return { meta, topology, osi_layers, frames, timeline };
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Parse capture data into dissected packets without generating scenario YAML.
 * Used by the analyze_capture tool.
 *
 * @param {object} opts
 * @param {'pcap_base64'|'tshark_json'} opts.input_format
 * @param {string} opts.data - base64-encoded PCAP or tshark JSON string
 * @param {number} [opts.max_packets=500]
 * @returns {{ packets: object[] }} Dissected packets with layers, summary, index, timestamp
 */
export function parseCapture({ input_format, data, max_packets = 500 }) {
  let parsed;

  if (input_format === 'pcap_base64') {
    const buf = Buffer.from(data, 'base64');
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parsed = parsePcap(arrayBuffer, max_packets);

    // Dissect binary packets
    parsed.packets = parsed.packets.map(pkt => {
      const { layers, summary } = dissectPacket(pkt);
      return { ...pkt, layers, summary };
    });
  } else if (input_format === 'tshark_json') {
    parsed = parseTsharkJson(data);

    // tshark packets are already "dissected" by convertTsharkPacket
    if (max_packets && parsed.packets.length > max_packets) {
      parsed.packets = parsed.packets.slice(0, max_packets);
    }
  } else {
    throw new Error(`Unsupported input_format: "${input_format}". Use "pcap_base64" or "tshark_json".`);
  }

  if (!parsed.packets || parsed.packets.length === 0) {
    throw new Error('No packets could be parsed from the input data.');
  }

  return parsed;
}

/**
 * Convert packet capture data to a ProtoViz scenario YAML string.
 *
 * @param {object} opts
 * @param {'pcap_base64'|'tshark_json'} opts.input_format
 * @param {string} opts.data - base64-encoded PCAP or tshark JSON string
 * @param {string} [opts.title]
 * @param {boolean} [opts.scrub=true]
 * @param {number} [opts.max_packets=500]
 * @returns {string} YAML scenario
 */
export function convertToScenarioYaml({ input_format, data, title, scrub = true, max_packets = 500 }) {
  let parsed;

  if (input_format === 'pcap_base64') {
    const buf = Buffer.from(data, 'base64');
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parsed = parsePcap(arrayBuffer, max_packets);

    // Dissect binary packets
    parsed.packets = parsed.packets.map(pkt => {
      const { layers, summary } = dissectPacket(pkt);
      return { ...pkt, layers, summary };
    });
  } else if (input_format === 'tshark_json') {
    parsed = parseTsharkJson(data);

    // tshark packets are already "dissected" by convertTsharkPacket
    if (max_packets && parsed.packets.length > max_packets) {
      parsed.packets = parsed.packets.slice(0, max_packets);
    }
  } else {
    throw new Error(`Unsupported input_format: "${input_format}". Use "pcap_base64" or "tshark_json".`);
  }

  if (!parsed.packets || parsed.packets.length === 0) {
    throw new Error('No packets could be parsed from the input data.');
  }

  const scenario = generateScenario(parsed.packets, { title, scrub });
  return yaml.dump(scenario, { lineWidth: 120, noRefs: true, quotingType: '"', forceQuotes: false });
}
