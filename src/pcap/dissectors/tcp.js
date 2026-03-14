export function dissectTCP(data, offset) {
  if (data.length < offset + 20) return null;

  const srcPort = (data[offset] << 8) | data[offset + 1];
  const dstPort = (data[offset + 2] << 8) | data[offset + 3];
  const seqNum = readUint32(data, offset + 4);
  const ackNum = readUint32(data, offset + 8);
  const dataOffsetByte = data[offset + 12];
  const dataOffset = (dataOffsetByte >> 4) * 4;
  const flags = data[offset + 13];
  const windowSize = (data[offset + 14] << 8) | data[offset + 15];
  const checksum = (data[offset + 16] << 8) | data[offset + 17];
  const urgentPtr = (data[offset + 18] << 8) | data[offset + 19];

  const flagNames = [];
  if (flags & 0x01) flagNames.push('FIN');
  if (flags & 0x02) flagNames.push('SYN');
  if (flags & 0x04) flagNames.push('RST');
  if (flags & 0x08) flagNames.push('PSH');
  if (flags & 0x10) flagNames.push('ACK');
  if (flags & 0x20) flagNames.push('URG');
  if (flags & 0x40) flagNames.push('ECE');
  if (flags & 0x80) flagNames.push('CWR');

  return {
    layer: 4,
    name: 'TCP',
    fields: {
      src_port: srcPort,
      dst_port: dstPort,
      seq_num: seqNum,
      ack_num: ackNum,
      data_offset: dataOffset,
      flags: `0x${flags.toString(16).padStart(2, '0')}`,
      flag_names: flagNames.join(','),
      window_size: windowSize,
      checksum: `0x${checksum.toString(16).padStart(4, '0')}`,
      urgent_ptr: urgentPtr,
    },
    nextOffset: offset + dataOffset,
    nextProtocol: null,
  };
}

function readUint32(data, offset) {
  return (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0;
}
