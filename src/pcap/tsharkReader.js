/**
 * Parser for tshark JSON output (`tshark -r capture.pcap -T json`).
 *
 * Converts tshark's protocol layer objects into our internal dissected
 * packet format so the same PacketList, FindingsPanel, and rule engine
 * can be used regardless of input source.
 */

// Map tshark protocol names to OSI layer numbers
const LAYER_MAP = {
  eth: 2,
  arp: 2,
  vlan: 2,
  ip: 3,
  ipv6: 3,
  icmp: 3,
  icmpv6: 3,
  tcp: 4,
  udp: 4,
  sctp: 4,
  infiniband: 4,
  bth: 4,     // IB Base Transport Header
  grh: 3,     // IB Global Route Header
  reth: 4,    // RDMA Extended Transport Header
  aeth: 4,    // ACK Extended Transport Header
  rdmap: 5,   // RDMA Protocol (iWARP)
  ddp: 5,     // Direct Data Placement (iWARP)
  mpa: 5,     // Marker PDU Aligned (iWARP)
  iwarp: 5,
  nvme: 5,
  'nvme-rdma': 5,
  'nvme-tcp': 5,
  iscsi: 5,
  fc: 2,      // Fibre Channel
  fcels: 5,   // FC ELS
  fcfcs: 5,   // FC Fabric Config
  fcns: 5,    // FC Name Server
  fcp: 5,     // FC Protocol (SCSI)
  fcdns: 5,   // FC Directory Name Server
  scsi: 7,    // SCSI
  dns: 7,
  http: 7,
  http2: 7,
  tls: 6,
  ssl: 6,
};

// Known tshark TCP flag field names
const TCP_FLAG_FIELDS = {
  'tcp.flags.fin': 'FIN',
  'tcp.flags.syn': 'SYN',
  'tcp.flags.reset': 'RST',
  'tcp.flags.push': 'PSH',
  'tcp.flags.ack': 'ACK',
  'tcp.flags.urg': 'URG',
  'tcp.flags.ece': 'ECE',
  'tcp.flags.cwr': 'CWR',
};

// BTH opcode names (IB spec)
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

/**
 * Parse tshark JSON output into our internal packet format.
 * @param {string} jsonText - Raw JSON string from tshark -T json
 * @returns {{ packets: object[] }}
 */
export function parseTsharkJson(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }

  if (!Array.isArray(raw)) {
    throw new Error('Expected a JSON array (tshark -T json output)');
  }

  if (raw.length === 0) {
    throw new Error('No packets found in JSON');
  }

  // Validate first element has the expected structure
  const first = raw[0];
  if (!first._source?.layers && !first.layers) {
    throw new Error('Unrecognized JSON format. Expected tshark -T json output with _source.layers or layers structure.');
  }

  const packets = raw.map((entry, index) => {
    const tsharkLayers = entry._source?.layers || entry.layers || {};
    return convertPacket(tsharkLayers, index);
  });

  return { packets };
}

function convertPacket(tsharkLayers, index) {
  const layers = [];
  let timestamp = 0;
  let capturedLen = 0;
  let originalLen = 0;
  const summaryParts = [];

  // Extract frame metadata
  const frame = tsharkLayers.frame;
  if (frame) {
    timestamp = parseFloat(frame['frame.time_epoch'] || '0');
    capturedLen = parseInt(frame['frame.cap_len'] || frame['frame.len'] || '0', 10);
    originalLen = parseInt(frame['frame.len'] || '0', 10);
  }

  // Process each protocol layer
  for (const [proto, fields] of Object.entries(tsharkLayers)) {
    if (proto === 'frame' || proto === 'frame_raw' || proto.endsWith('_raw')) continue;
    if (typeof fields !== 'object' || fields === null) continue;

    const layerNum = LAYER_MAP[proto] || guessLayerNum(proto);
    const converted = convertLayer(proto, fields, layerNum, summaryParts);
    if (converted) layers.push(converted);
  }

  // Build summary from parts
  const summary = summaryParts.join(' | ') || layers.map(l => l.name).join(' → ');

  return {
    index,
    timestamp,
    capturedLen,
    originalLen,
    layers,
    summary,
    data: new Uint8Array(0), // No raw data in JSON mode
  };
}

function guessLayerNum(proto) {
  // Common patterns for unknown protocols
  if (/^eth|^mac|^llc|^stp|^lldp|^cdp/.test(proto)) return 2;
  if (/^ip|^igmp|^ospf|^bgp|^rip/.test(proto)) return 3;
  if (/^tcp|^udp|^sctp|^dccp/.test(proto)) return 4;
  return 5; // Default to session layer for unknown protocols
}

function convertLayer(proto, fields, layerNum, summaryParts) {
  // Flatten tshark's nested field objects into simple key-value pairs
  const flatFields = {};
  flattenFields(fields, proto, flatFields);

  // Protocol-specific summary generation
  switch (proto) {
    case 'eth':
      return {
        layer: 2,
        name: 'Ethernet',
        fields: {
          dst_mac: flatFields['eth.dst'] || '',
          src_mac: flatFields['eth.src'] || '',
          ethertype: flatFields['eth.type'] || '',
        },
      };

    case 'ip':
      summaryParts.push(`${flatFields['ip.src'] || '?'} → ${flatFields['ip.dst'] || '?'}`);
      return {
        layer: 3,
        name: 'IPv4',
        fields: {
          src_ip: flatFields['ip.src'] || '',
          dst_ip: flatFields['ip.dst'] || '',
          ttl: flatFields['ip.ttl'] || '',
          protocol: flatFields['ip.proto'] || '',
          dscp: flatFields['ip.dsfield.dscp'] || '',
          ecn: flatFields['ip.dsfield.ecn'] || '',
          total_length: flatFields['ip.len'] || '',
        },
      };

    case 'ipv6':
      summaryParts.push(`${flatFields['ipv6.src'] || '?'} → ${flatFields['ipv6.dst'] || '?'}`);
      return {
        layer: 3,
        name: 'IPv6',
        fields: {
          src_ip: flatFields['ipv6.src'] || '',
          dst_ip: flatFields['ipv6.dst'] || '',
          hop_limit: flatFields['ipv6.hlim'] || '',
          next_header: flatFields['ipv6.nxt'] || '',
          flow_label: flatFields['ipv6.flow'] || '',
        },
      };

    case 'tcp': {
      const flagNames = [];
      for (const [fk, fn] of Object.entries(TCP_FLAG_FIELDS)) {
        if (flatFields[fk] === '1') flagNames.push(fn);
      }
      const flagStr = flagNames.join(',');
      summaryParts.push(`TCP ${flatFields['tcp.srcport'] || '?'}→${flatFields['tcp.dstport'] || '?'} [${flagStr}]`);
      return {
        layer: 4,
        name: 'TCP',
        fields: {
          src_port: parseInt(flatFields['tcp.srcport'] || '0', 10),
          dst_port: parseInt(flatFields['tcp.dstport'] || '0', 10),
          seq_num: parseInt(flatFields['tcp.seq'] || flatFields['tcp.seq_raw'] || '0', 10),
          ack_num: parseInt(flatFields['tcp.ack'] || flatFields['tcp.ack_raw'] || '0', 10),
          flags: flatFields['tcp.flags'] || '',
          flag_names: flagStr,
          window_size: parseInt(flatFields['tcp.window_size_value'] || flatFields['tcp.window_size'] || '0', 10),
        },
      };
    }

    case 'udp':
      summaryParts.push(`UDP ${flatFields['udp.srcport'] || '?'}→${flatFields['udp.dstport'] || '?'}`);
      return {
        layer: 4,
        name: 'UDP',
        fields: {
          src_port: parseInt(flatFields['udp.srcport'] || '0', 10),
          dst_port: parseInt(flatFields['udp.dstport'] || '0', 10),
          length: parseInt(flatFields['udp.length'] || '0', 10),
        },
      };

    case 'arp':
      summaryParts.push(`ARP ${flatFields['arp.opcode'] === '1' ? 'Request' : 'Reply'} ${flatFields['arp.src.proto_ipv4'] || ''} → ${flatFields['arp.dst.proto_ipv4'] || ''}`);
      return {
        layer: 2,
        name: 'ARP',
        fields: {
          opcode: flatFields['arp.opcode'] || '',
          sender_mac: flatFields['arp.src.hw_mac'] || '',
          sender_ip: flatFields['arp.src.proto_ipv4'] || '',
          target_mac: flatFields['arp.dst.hw_mac'] || '',
          target_ip: flatFields['arp.dst.proto_ipv4'] || '',
        },
      };

    case 'infiniband':
    case 'bth': {
      const opcode = parseInt(flatFields['infiniband.bth.opcode'] || flatFields['bth.opcode'] || '0', 10);
      const opcodeName = BTH_OPCODE_NAMES[opcode] || `Opcode ${opcode}`;
      const destQp = parseInt(flatFields['infiniband.bth.destqp'] || flatFields['bth.destqp'] || '0', 10);
      const psn = parseInt(flatFields['infiniband.bth.psn'] || flatFields['bth.psn'] || '0', 10);
      summaryParts.push(`RoCEv2 ${opcodeName} QP=${destQp} PSN=${psn}`);
      return {
        layer: 4,
        name: `BTH (${opcodeName})`,
        fields: {
          opcode,
          opcode_name: opcodeName,
          dest_qp: destQp,
          psn,
          pkey: flatFields['infiniband.bth.pkey'] || flatFields['bth.pkey'] || '',
          ack_req: flatFields['infiniband.bth.ackreq'] || flatFields['bth.ackreq'] || '',
        },
      };
    }

    case 'reth':
      return {
        layer: 4,
        name: 'RETH',
        fields: {
          virtual_address: flatFields['infiniband.reth.va'] || flatFields['reth.va'] || '',
          rkey: flatFields['infiniband.reth.rkey'] || flatFields['reth.rkey'] || '',
          dma_length: flatFields['infiniband.reth.dmalen'] || flatFields['reth.dmalen'] || '',
        },
      };

    case 'aeth':
      return {
        layer: 4,
        name: 'AETH',
        fields: {
          syndrome: flatFields['infiniband.aeth.syndrome'] || flatFields['aeth.syndrome'] || '',
          msn: flatFields['infiniband.aeth.msn'] || flatFields['aeth.msn'] || '',
        },
      };

    default: {
      // Generic: include all flat fields for unknown protocols
      const protoName = proto.toUpperCase();
      // Pick a reasonable subset of fields (first 20)
      const selectedFields = {};
      let count = 0;
      for (const [k, v] of Object.entries(flatFields)) {
        if (count >= 20) break;
        // Strip protocol prefix for readability
        const shortKey = k.startsWith(proto + '.') ? k.slice(proto.length + 1) : k;
        selectedFields[shortKey] = v;
        count++;
      }
      if (Object.keys(selectedFields).length === 0) return null;
      return {
        layer: layerNum,
        name: protoName,
        fields: selectedFields,
      };
    }
  }
}

/**
 * Recursively flatten tshark's nested field objects.
 * tshark JSON can have nested objects and arrays for field trees.
 */
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
