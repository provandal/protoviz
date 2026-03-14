export function dissectUDP(data, offset) {
  if (data.length < offset + 8) return null;

  const srcPort = (data[offset] << 8) | data[offset + 1];
  const dstPort = (data[offset + 2] << 8) | data[offset + 3];
  const length = (data[offset + 4] << 8) | data[offset + 5];
  const checksum = (data[offset + 6] << 8) | data[offset + 7];

  return {
    layer: 4,
    name: 'UDP',
    fields: {
      src_port: srcPort,
      dst_port: dstPort,
      length,
      checksum: `0x${checksum.toString(16).padStart(4, '0')}`,
    },
    nextOffset: offset + 8,
    nextProtocol: dstPort, // Use dest port to identify upper-layer protocol
  };
}

// RoCEv2 uses UDP destination port 4791
export const ROCE_V2_PORT = 4791;
