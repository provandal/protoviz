export function dissectIPv4(data, offset) {
  if (data.length < offset + 20) return null;

  const versionIhl = data[offset];
  const version = versionIhl >> 4;
  const ihl = (versionIhl & 0x0f) * 4;

  if (version !== 4) return null;

  const dscp = data[offset + 1] >> 2;
  const ecn = data[offset + 1] & 0x03;
  const totalLength = (data[offset + 2] << 8) | data[offset + 3];
  const identification = (data[offset + 4] << 8) | data[offset + 5];
  const flags = data[offset + 6] >> 5;
  const fragmentOffset = ((data[offset + 6] & 0x1f) << 8) | data[offset + 7];
  const ttl = data[offset + 8];
  const protocol = data[offset + 9];
  const checksum = (data[offset + 10] << 8) | data[offset + 11];
  const srcIp = formatIp(data, offset + 12);
  const dstIp = formatIp(data, offset + 16);

  return {
    layer: 3,
    name: 'IPv4',
    fields: {
      version,
      ihl,
      dscp,
      ecn,
      total_length: totalLength,
      identification: `0x${identification.toString(16)}`,
      flags,
      fragment_offset: fragmentOffset,
      ttl,
      protocol,
      protocol_name: IP_PROTOCOLS[protocol] || 'Unknown',
      checksum: `0x${checksum.toString(16).padStart(4, '0')}`,
      src_ip: srcIp,
      dst_ip: dstIp,
    },
    nextOffset: offset + ihl,
    nextProtocol: protocol,
  };
}

function formatIp(data, offset) {
  return `${data[offset]}.${data[offset + 1]}.${data[offset + 2]}.${data[offset + 3]}`;
}

export const IP_PROTOCOLS = {
  1: 'ICMP',
  6: 'TCP',
  17: 'UDP',
  47: 'GRE',
};
