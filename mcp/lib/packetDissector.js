/**
 * Detailed single-packet dissector for the explain_packet tool.
 * Produces extremely detailed output with spec references, field descriptions,
 * byte offsets, bit widths, and human-readable decoded values.
 */

// ─── Constants ──────────────────────────────────────────────────

const ETHERTYPES = {
  0x0800: 'IPv4', 0x0806: 'ARP', 0x86dd: 'IPv6',
  0x8100: '802.1Q VLAN', 0x8915: 'RoCEv1', 0x88cc: 'LLDP',
};

const IP_PROTOCOLS = {
  1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 47: 'GRE',
  50: 'ESP', 51: 'AH', 58: 'ICMPv6', 89: 'OSPF', 132: 'SCTP',
};

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
  0x64: 'UD Send Only', 0x65: 'UD Send Only w/ Immediate',
};

const RETH_OPCODES = new Set([0x06, 0x0a, 0x0b, 0x0c]);
const AETH_OPCODES = new Set([0x0d, 0x0f, 0x10, 0x11, 0x12]);
const AETH_TYPES = { 0: 'ACK', 1: 'RNR NAK', 2: 'Reserved', 3: 'NAK' };

const ARP_OPCODES = { 1: 'Request', 2: 'Reply', 3: 'RARP Request', 4: 'RARP Reply' };

// ─── Helpers ────────────────────────────────────────────────────

function formatMac(data, offset) {
  return Array.from(data.slice(offset, offset + 6))
    .map(b => b.toString(16).padStart(2, '0')).join(':');
}

function formatIp(data, offset) {
  return `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
}

function readUint16(data, offset) {
  return (data[offset] << 8) | data[offset + 1];
}

function readUint32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function hexVal(value, width) {
  return `0x${value.toString(16).padStart(width, '0')}`;
}

// ─── Layer Dissectors ───────────────────────────────────────────

function dissectEthernet(data, offset) {
  if (data.length < offset + 14) return null;

  const dstMac = formatMac(data, offset);
  const srcMac = formatMac(data, offset + 6);
  const ethertype = readUint16(data, offset + 12);

  const fields = [
    {
      name: 'Destination MAC',
      abbrev: 'eth.dst',
      offset: offset,
      bits: 48,
      value: dstMac,
      description: 'Destination hardware (MAC) address. Broadcast = ff:ff:ff:ff:ff:ff.',
      spec_ref: 'IEEE 802.3, \u00a73.2.3',
    },
    {
      name: 'Source MAC',
      abbrev: 'eth.src',
      offset: offset + 6,
      bits: 48,
      value: srcMac,
      description: 'Source hardware (MAC) address of the sending NIC.',
      spec_ref: 'IEEE 802.3, \u00a73.2.3',
    },
    {
      name: 'EtherType',
      abbrev: 'eth.type',
      offset: offset + 12,
      bits: 16,
      value: hexVal(ethertype, 4),
      decoded: ETHERTYPES[ethertype] || `Unknown (${hexVal(ethertype, 4)})`,
      description: 'Identifies the payload protocol. 0x0800=IPv4, 0x0806=ARP, 0x86dd=IPv6.',
      spec_ref: 'IEEE 802.3, \u00a73.2.6',
    },
  ];

  return {
    name: 'Ethernet II',
    fields,
    nextOffset: offset + 14,
    nextProtocol: ethertype,
  };
}

function dissectArp(data, offset) {
  if (data.length < offset + 28) return null;

  const hwType = readUint16(data, offset);
  const protoType = readUint16(data, offset + 2);
  const hwSize = data[offset + 4];
  const protoSize = data[offset + 5];
  const opcode = readUint16(data, offset + 6);
  const senderMac = formatMac(data, offset + 8);
  const senderIp = formatIp(data, offset + 14);
  const targetMac = formatMac(data, offset + 18);
  const targetIp = formatIp(data, offset + 24);

  const fields = [
    { name: 'Hardware Type', abbrev: 'arp.hw.type', offset, bits: 16, value: hwType, decoded: hwType === 1 ? 'Ethernet (1)' : `${hwType}`, description: 'Link-layer type. 1 = Ethernet.', spec_ref: 'RFC 826' },
    { name: 'Protocol Type', abbrev: 'arp.proto.type', offset: offset + 2, bits: 16, value: hexVal(protoType, 4), decoded: protoType === 0x0800 ? 'IPv4' : hexVal(protoType, 4), description: 'Network protocol. 0x0800 = IPv4.', spec_ref: 'RFC 826' },
    { name: 'Hardware Size', abbrev: 'arp.hw.size', offset: offset + 4, bits: 8, value: hwSize, description: 'Length of hardware addresses in bytes (6 for Ethernet).', spec_ref: 'RFC 826' },
    { name: 'Protocol Size', abbrev: 'arp.proto.size', offset: offset + 5, bits: 8, value: protoSize, description: 'Length of protocol addresses in bytes (4 for IPv4).', spec_ref: 'RFC 826' },
    { name: 'Opcode', abbrev: 'arp.opcode', offset: offset + 6, bits: 16, value: opcode, decoded: ARP_OPCODES[opcode] || `Unknown (${opcode})`, description: 'ARP operation: 1=Request, 2=Reply.', spec_ref: 'RFC 826' },
    { name: 'Sender MAC', abbrev: 'arp.src.hw_mac', offset: offset + 8, bits: 48, value: senderMac, description: 'Hardware address of the sender.', spec_ref: 'RFC 826' },
    { name: 'Sender IP', abbrev: 'arp.src.proto_ipv4', offset: offset + 14, bits: 32, value: senderIp, description: 'Protocol (IP) address of the sender.', spec_ref: 'RFC 826' },
    { name: 'Target MAC', abbrev: 'arp.dst.hw_mac', offset: offset + 18, bits: 48, value: targetMac, description: 'Hardware address of the target (00:00:00:00:00:00 in requests).', spec_ref: 'RFC 826' },
    { name: 'Target IP', abbrev: 'arp.dst.proto_ipv4', offset: offset + 24, bits: 32, value: targetIp, description: 'Protocol (IP) address of the target being resolved.', spec_ref: 'RFC 826' },
  ];

  return { name: `ARP ${ARP_OPCODES[opcode] || ''}`.trim(), fields, nextOffset: offset + 28, nextProtocol: null };
}

function dissectIPv4(data, offset) {
  if (data.length < offset + 20) return null;

  const versionIhl = data[offset];
  const version = versionIhl >> 4;
  const ihl = (versionIhl & 0x0f) * 4;
  if (version !== 4 || ihl < 20) return null;

  const dscp = data[offset + 1] >> 2;
  const ecn = data[offset + 1] & 0x03;
  const totalLength = readUint16(data, offset + 2);
  const identification = readUint16(data, offset + 4);
  const flagsFrag = readUint16(data, offset + 6);
  const flags = (flagsFrag >> 13) & 0x07;
  const fragOffset = flagsFrag & 0x1fff;
  const ttl = data[offset + 8];
  const protocol = data[offset + 9];
  const headerChecksum = readUint16(data, offset + 10);
  const srcIp = formatIp(data, offset + 12);
  const dstIp = formatIp(data, offset + 16);

  const ecnNames = ['Not-ECT', 'ECT(1)', 'ECT(0)', 'CE'];
  const flagParts = [];
  if (flags & 0x04) flagParts.push('Reserved');
  if (flags & 0x02) flagParts.push('DF');
  if (flags & 0x01) flagParts.push('MF');

  const fields = [
    { name: 'Version', abbrev: 'ip.version', offset, bits: 4, value: version, description: 'IP version number. Always 4 for IPv4.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Header Length', abbrev: 'ip.hdr_len', offset, bits: 4, value: ihl, decoded: `${ihl} bytes`, description: 'Internet Header Length in 32-bit words. Minimum 20 bytes (5 words).', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'DSCP', abbrev: 'ip.dsfield.dscp', offset: offset + 1, bits: 6, value: dscp, description: 'Differentiated Services Code Point for QoS classification. 0 = Best Effort.', spec_ref: 'RFC 2474, \u00a73' },
    { name: 'ECN', abbrev: 'ip.dsfield.ecn', offset: offset + 1, bits: 2, value: ecn, decoded: ecnNames[ecn], description: 'Explicit Congestion Notification. Used by RoCEv2/DCQCN for lossless signaling.', spec_ref: 'RFC 3168, \u00a75' },
    { name: 'Total Length', abbrev: 'ip.len', offset: offset + 2, bits: 16, value: totalLength, decoded: `${totalLength} bytes`, description: 'Total datagram length including header and payload.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Identification', abbrev: 'ip.id', offset: offset + 4, bits: 16, value: hexVal(identification, 4), description: 'Used to reassemble fragmented datagrams.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Flags', abbrev: 'ip.flags', offset: offset + 6, bits: 3, value: hexVal(flags, 1), decoded: flagParts.join(', ') || 'None', description: 'Fragmentation control: DF=Don\'t Fragment, MF=More Fragments.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Fragment Offset', abbrev: 'ip.frag_offset', offset: offset + 6, bits: 13, value: fragOffset, decoded: `${fragOffset * 8} bytes`, description: 'Position of this fragment in the original datagram (in 8-byte units).', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Time to Live', abbrev: 'ip.ttl', offset: offset + 8, bits: 8, value: ttl, description: 'Maximum number of hops. Decremented by each router; packet discarded at 0.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Protocol', abbrev: 'ip.proto', offset: offset + 9, bits: 8, value: protocol, decoded: IP_PROTOCOLS[protocol] || `Unknown (${protocol})`, description: 'Identifies the upper-layer protocol. 6=TCP, 17=UDP.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Header Checksum', abbrev: 'ip.checksum', offset: offset + 10, bits: 16, value: hexVal(headerChecksum, 4), description: 'One\'s complement checksum of the IP header only (not payload).', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Source IP', abbrev: 'ip.src', offset: offset + 12, bits: 32, value: srcIp, description: 'Source IPv4 address.', spec_ref: 'RFC 791, \u00a73.1' },
    { name: 'Destination IP', abbrev: 'ip.dst', offset: offset + 16, bits: 32, value: dstIp, description: 'Destination IPv4 address.', spec_ref: 'RFC 791, \u00a73.1' },
  ];

  return {
    name: 'IPv4',
    fields,
    nextOffset: offset + ihl,
    nextProtocol: protocol,
  };
}

function dissectTCP(data, offset) {
  if (data.length < offset + 20) return null;

  const srcPort = readUint16(data, offset);
  const dstPort = readUint16(data, offset + 2);
  const seqNum = readUint32(data, offset + 4);
  const ackNum = readUint32(data, offset + 8);
  const dataOff = (data[offset + 12] >> 4) * 4;
  const reserved = (data[offset + 12] & 0x0e) >> 1;
  const ns = data[offset + 12] & 0x01;
  const flags = data[offset + 13];
  const windowSize = readUint16(data, offset + 14);
  const checksum = readUint16(data, offset + 16);
  const urgPtr = readUint16(data, offset + 18);

  const flagNames = [];
  if (flags & 0x80) flagNames.push('CWR');
  if (flags & 0x40) flagNames.push('ECE');
  if (flags & 0x20) flagNames.push('URG');
  if (flags & 0x10) flagNames.push('ACK');
  if (flags & 0x08) flagNames.push('PSH');
  if (flags & 0x04) flagNames.push('RST');
  if (flags & 0x02) flagNames.push('SYN');
  if (flags & 0x01) flagNames.push('FIN');

  const fields = [
    { name: 'Source Port', abbrev: 'tcp.srcport', offset, bits: 16, value: srcPort, description: 'Sending port number. Ephemeral ports are typically 49152-65535.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Destination Port', abbrev: 'tcp.dstport', offset: offset + 2, bits: 16, value: dstPort, description: 'Receiving port number. Well-known ports: 80=HTTP, 443=HTTPS, 4420=iSCSI.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Sequence Number', abbrev: 'tcp.seq', offset: offset + 4, bits: 32, value: seqNum, description: 'Byte-stream position of the first data byte in this segment. SYN and FIN each consume one sequence number.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Acknowledgment Number', abbrev: 'tcp.ack', offset: offset + 8, bits: 32, value: ackNum, description: 'Next expected byte from the remote side (only valid when ACK flag is set).', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Data Offset', abbrev: 'tcp.hdr_len', offset: offset + 12, bits: 4, value: dataOff, decoded: `${dataOff} bytes`, description: 'TCP header length in 32-bit words. Minimum 20 bytes (5); options increase this.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Flags', abbrev: 'tcp.flags', offset: offset + 13, bits: 8, value: hexVal(flags, 2), decoded: flagNames.join(', ') || 'None', description: 'Control bits: SYN=synchronize, ACK=acknowledge, FIN=finish, RST=reset, PSH=push, URG=urgent.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Window Size', abbrev: 'tcp.window_size', offset: offset + 14, bits: 16, value: windowSize, description: 'Receive window size (before scaling). Tells sender how much buffer space is available.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Checksum', abbrev: 'tcp.checksum', offset: offset + 16, bits: 16, value: hexVal(checksum, 4), description: 'Covers TCP header, payload, and a pseudo-header from IP.', spec_ref: 'RFC 9293, \u00a73.1' },
    { name: 'Urgent Pointer', abbrev: 'tcp.urgent_pointer', offset: offset + 18, bits: 16, value: urgPtr, description: 'Offset from sequence number of last urgent data byte (only valid when URG flag is set).', spec_ref: 'RFC 9293, \u00a73.1' },
  ];

  // Parse TCP Options if header is longer than 20 bytes
  if (dataOff > 20 && data.length >= offset + dataOff) {
    let optOffset = offset + 20;
    while (optOffset < offset + dataOff) {
      const kind = data[optOffset];
      if (kind === 0) break; // End of options
      if (kind === 1) { optOffset++; continue; } // NOP

      const optLen = data[optOffset + 1] || 1;
      if (optLen < 2 || optOffset + optLen > offset + dataOff) break;

      if (kind === 2 && optLen === 4) {
        const mss = readUint16(data, optOffset + 2);
        fields.push({ name: 'Option: MSS', abbrev: 'tcp.options.mss', offset: optOffset, bits: 32, value: mss, decoded: `${mss} bytes`, description: 'Maximum Segment Size. The largest payload the sender can receive per TCP segment.', spec_ref: 'RFC 9293, \u00a73.1' });
      } else if (kind === 3 && optLen === 3) {
        const scale = data[optOffset + 2];
        fields.push({ name: 'Option: Window Scale', abbrev: 'tcp.options.wscale', offset: optOffset, bits: 24, value: scale, decoded: `multiply by ${Math.pow(2, scale)}`, description: 'Window Scale factor. Effective window = window_size * 2^scale.', spec_ref: 'RFC 7323, \u00a72' });
      } else if (kind === 4 && optLen === 2) {
        fields.push({ name: 'Option: SACK Permitted', abbrev: 'tcp.options.sack_perm', offset: optOffset, bits: 16, value: true, decoded: 'Permitted', description: 'Selective Acknowledgment permitted. Enables more efficient loss recovery.', spec_ref: 'RFC 2018' });
      } else if (kind === 8 && optLen === 10) {
        const tsVal = readUint32(data, optOffset + 2);
        const tsEcr = readUint32(data, optOffset + 6);
        fields.push({ name: 'Option: Timestamp Value', abbrev: 'tcp.options.timestamp.tsval', offset: optOffset + 2, bits: 32, value: tsVal, description: 'Sender\'s timestamp for RTT measurement.', spec_ref: 'RFC 7323, \u00a73' });
        fields.push({ name: 'Option: Timestamp Echo Reply', abbrev: 'tcp.options.timestamp.tsecr', offset: optOffset + 6, bits: 32, value: tsEcr, description: 'Echo of remote\'s timestamp for RTT measurement.', spec_ref: 'RFC 7323, \u00a73' });
      }

      optOffset += optLen;
    }
  }

  return {
    name: `TCP [${flagNames.join(',')}]`,
    fields,
    nextOffset: offset + dataOff,
  };
}

function dissectUDP(data, offset) {
  if (data.length < offset + 8) return null;

  const srcPort = readUint16(data, offset);
  const dstPort = readUint16(data, offset + 2);
  const length = readUint16(data, offset + 4);
  const checksum = readUint16(data, offset + 6);

  const fields = [
    { name: 'Source Port', abbrev: 'udp.srcport', offset, bits: 16, value: srcPort, description: 'Sending port number.', spec_ref: 'RFC 768' },
    { name: 'Destination Port', abbrev: 'udp.dstport', offset: offset + 2, bits: 16, value: dstPort, description: 'Receiving port number. RoCEv2 uses 4791.', spec_ref: 'RFC 768' },
    { name: 'Length', abbrev: 'udp.length', offset: offset + 4, bits: 16, value: length, decoded: `${length} bytes`, description: 'Total datagram length including 8-byte header and payload.', spec_ref: 'RFC 768' },
    { name: 'Checksum', abbrev: 'udp.checksum', offset: offset + 6, bits: 16, value: hexVal(checksum, 4), description: 'Optional in IPv4, mandatory in IPv6. Covers UDP header, payload, and IP pseudo-header.', spec_ref: 'RFC 768' },
  ];

  return { name: 'UDP', fields, nextOffset: offset + 8, srcPort, dstPort };
}

function dissectBTH(data, offset) {
  if (data.length < offset + 12) return null;

  const opcode = data[offset];
  const se = !!(data[offset + 1] & 0x80);
  const migReq = (data[offset + 1] >> 6) & 0x01;
  const padCount = (data[offset + 1] >> 4) & 0x03;
  const tver = data[offset + 1] & 0x0f;
  const pkey = readUint16(data, offset + 2);
  const reserved = data[offset + 4];
  const destQP = ((data[offset + 5] << 16) | (data[offset + 6] << 8) | data[offset + 7]) & 0x00ffffff;
  const ackReq = !!(data[offset + 8] & 0x80);
  const psn = ((data[offset + 9] << 16) | (data[offset + 10] << 8) | data[offset + 11]) & 0x00ffffff;

  const opName = BTH_OPCODES[opcode] || `Unknown (${hexVal(opcode, 2)})`;

  const fields = [
    { name: 'Opcode', abbrev: 'bth.opcode', offset, bits: 8, value: hexVal(opcode, 2), decoded: opName, description: 'IB transport opcode. Determines the operation type and which extension headers follow.', spec_ref: 'IB Spec Vol 1, \u00a79.2, Table 38' },
    { name: 'Solicited Event', abbrev: 'bth.se', offset: offset + 1, bits: 1, value: se, description: 'If set, generate a completion event on the receiver\'s CQ.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'MigReq', abbrev: 'bth.migreq', offset: offset + 1, bits: 1, value: migReq, description: 'Migration request state for path migration.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'Pad Count', abbrev: 'bth.padcnt', offset: offset + 1, bits: 2, value: padCount, description: 'Number of padding bytes added to align payload to 4-byte boundary.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'Transport Header Version', abbrev: 'bth.tver', offset: offset + 1, bits: 4, value: tver, description: 'Transport header version (always 0 for current IB spec).', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'Partition Key', abbrev: 'bth.pkey', offset: offset + 2, bits: 16, value: hexVal(pkey, 4), description: 'Partition key for access control. 0xFFFF = default full partition.', spec_ref: 'IB Spec Vol 1, \u00a79.2.1' },
    { name: 'Destination QP', abbrev: 'bth.destqp', offset: offset + 5, bits: 24, value: destQP, description: 'Destination Queue Pair number on the remote node.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'ACK Request', abbrev: 'bth.ackreq', offset: offset + 8, bits: 1, value: ackReq, description: 'If set, the responder must generate an ACK for this packet.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
    { name: 'Packet Sequence Number', abbrev: 'bth.psn', offset: offset + 9, bits: 24, value: psn, description: 'PSN for reliable transport ordering. 24-bit value wraps at 2^24. Gaps indicate lost packets.', spec_ref: 'IB Spec Vol 1, \u00a79.2' },
  ];

  return { name: `BTH (${opName})`, fields, nextOffset: offset + 12, opcodeNum: opcode };
}

function dissectRETH(data, offset) {
  if (data.length < offset + 16) return null;

  const vaHigh = readUint32(data, offset);
  const vaLow = readUint32(data, offset + 4);
  const rkey = readUint32(data, offset + 8);
  const dmaLength = readUint32(data, offset + 12);

  const va = `0x${vaHigh.toString(16).padStart(8, '0')}${vaLow.toString(16).padStart(8, '0')}`;

  const fields = [
    { name: 'Virtual Address', abbrev: 'reth.va', offset, bits: 64, value: va, description: 'Remote virtual address where RDMA operation targets. Must be within a registered Memory Region.', spec_ref: 'IB Spec Vol 1, \u00a79.2.2' },
    { name: 'Remote Key', abbrev: 'reth.rkey', offset: offset + 8, bits: 32, value: hexVal(rkey, 8), description: 'Remote Memory Region key. Authorizes remote access to the MR. Provided during MR exchange.', spec_ref: 'IB Spec Vol 1, \u00a79.2.2' },
    { name: 'DMA Length', abbrev: 'reth.dmalen', offset: offset + 12, bits: 32, value: dmaLength, decoded: `${dmaLength} bytes`, description: 'Number of bytes to transfer in this RDMA operation.', spec_ref: 'IB Spec Vol 1, \u00a79.2.2' },
  ];

  return { name: 'RETH', fields, nextOffset: offset + 16 };
}

function dissectAETH(data, offset) {
  if (data.length < offset + 4) return null;

  const syndrome = data[offset];
  const msn = ((data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) & 0x00ffffff;
  const ackType = (syndrome >> 5) & 0x07;
  const creditCount = syndrome & 0x1f;

  const fields = [
    { name: 'Syndrome', abbrev: 'aeth.syndrome', offset, bits: 8, value: hexVal(syndrome, 2), decoded: AETH_TYPES[ackType] || `Unknown (${ackType})`, description: 'Acknowledgement type (bits 7:5) and credit count (bits 4:0). 0=ACK, 1=RNR NAK, 3=NAK.', spec_ref: 'IB Spec Vol 1, \u00a79.2.4' },
    { name: 'ACK Type', abbrev: 'aeth.ack_type', offset, bits: 3, value: ackType, decoded: AETH_TYPES[ackType] || 'Unknown', description: 'Acknowledgement type: ACK (normal), RNR NAK (receiver not ready), NAK (error).', spec_ref: 'IB Spec Vol 1, \u00a79.2.4' },
    { name: 'Credit Count', abbrev: 'aeth.credit_count', offset, bits: 5, value: creditCount, description: 'Number of additional requests the responder can accept (flow control credits).', spec_ref: 'IB Spec Vol 1, \u00a79.2.4' },
    { name: 'Message Sequence Number', abbrev: 'aeth.msn', offset: offset + 1, bits: 24, value: msn, description: 'Sequence number of the last completed message. Used to track multi-packet message progress.', spec_ref: 'IB Spec Vol 1, \u00a79.2.4' },
  ];

  return { name: 'AETH', fields, nextOffset: offset + 4 };
}

// ─── Full Dissection Pipeline ───────────────────────────────────

/**
 * Dissect raw packet bytes into structured layers with detailed field info.
 * @param {Uint8Array} data - Raw packet bytes
 * @param {number} startOffset - Byte offset to start dissection (0 = Ethernet)
 * @returns {{ layers: object[], summary: string }}
 */
export function dissectPacketDetailed(data, startOffset = 0) {
  const layers = [];
  let layerNum = 1;

  // Layer 2: Ethernet
  const eth = dissectEthernet(data, startOffset);
  if (!eth) {
    return {
      layers: [],
      summary: `Truncated frame: only ${data.length - startOffset} bytes available (need at least 14 for Ethernet)`,
    };
  }
  layers.push({ layer_num: layerNum++, name: eth.name, fields: eth.fields });

  // Handle EtherType
  if (eth.nextProtocol === 0x0806) {
    // ARP
    const arp = dissectArp(data, eth.nextOffset);
    if (arp) {
      layers.push({ layer_num: layerNum++, name: arp.name, fields: arp.fields });
      return { layers, summary: `ARP ${arp.name.replace('ARP ', '')}` };
    }
    return { layers, summary: 'Truncated ARP' };
  }

  if (eth.nextProtocol !== 0x0800) {
    const protoName = ETHERTYPES[eth.nextProtocol] || `Unknown EtherType ${hexVal(eth.nextProtocol, 4)}`;
    return { layers, summary: protoName };
  }

  // Layer 3: IPv4
  const ip = dissectIPv4(data, eth.nextOffset);
  if (!ip) {
    return { layers, summary: 'Truncated IPv4 header' };
  }
  layers.push({ layer_num: layerNum++, name: ip.name, fields: ip.fields });

  let summary = `${ip.fields.find(f => f.abbrev === 'ip.src').value} -> ${ip.fields.find(f => f.abbrev === 'ip.dst').value}`;

  // Layer 4
  if (ip.nextProtocol === 17) {
    // UDP
    const udp = dissectUDP(data, ip.nextOffset);
    if (!udp) {
      return { layers, summary: summary + ' | Truncated UDP' };
    }
    layers.push({ layer_num: layerNum++, name: udp.name, fields: udp.fields });

    if (udp.srcPort === ROCE_V2_PORT || udp.dstPort === ROCE_V2_PORT) {
      // RoCEv2 BTH
      const bth = dissectBTH(data, udp.nextOffset);
      if (bth) {
        layers.push({ layer_num: layerNum++, name: bth.name, fields: bth.fields });
        const opName = bth.fields.find(f => f.abbrev === 'bth.opcode').decoded;
        const destQp = bth.fields.find(f => f.abbrev === 'bth.destqp').value;
        const psn = bth.fields.find(f => f.abbrev === 'bth.psn').value;
        summary += ` | RoCEv2 ${opName} QP=${destQp} PSN=${psn}`;

        let nextOff = bth.nextOffset;
        if (RETH_OPCODES.has(bth.opcodeNum)) {
          const reth = dissectRETH(data, nextOff);
          if (reth) {
            layers.push({ layer_num: layerNum++, name: reth.name, fields: reth.fields });
            nextOff = reth.nextOffset;
          }
        }
        if (AETH_OPCODES.has(bth.opcodeNum)) {
          const aeth = dissectAETH(data, nextOff);
          if (aeth) {
            layers.push({ layer_num: layerNum++, name: aeth.name, fields: aeth.fields });
          }
        }
      }
    } else {
      summary += ` | UDP ${udp.srcPort}->${udp.dstPort}`;
    }
  } else if (ip.nextProtocol === 6) {
    // TCP
    const tcp = dissectTCP(data, ip.nextOffset);
    if (!tcp) {
      return { layers, summary: summary + ' | Truncated TCP' };
    }
    layers.push({ layer_num: layerNum++, name: tcp.name, fields: tcp.fields });
    const flagStr = tcp.fields.find(f => f.abbrev === 'tcp.flags')?.decoded || '';
    const srcP = tcp.fields.find(f => f.abbrev === 'tcp.srcport').value;
    const dstP = tcp.fields.find(f => f.abbrev === 'tcp.dstport').value;
    summary += ` | TCP ${srcP}->${dstP} [${flagStr}]`;
  } else {
    const protoName = IP_PROTOCOLS[ip.nextProtocol] || `IP Protocol ${ip.nextProtocol}`;
    summary += ` | ${protoName}`;
  }

  // Note remaining payload
  const lastLayer = layers[layers.length - 1];
  const lastField = lastLayer.fields[lastLayer.fields.length - 1];
  const consumedBytes = (lastField.offset || 0) + Math.ceil((lastField.bits || 0) / 8);
  const remaining = data.length - consumedBytes;
  if (remaining > 0) {
    summary += ` (${remaining} bytes payload)`;
  }

  return { layers, summary };
}
