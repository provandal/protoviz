export function dissectEthernet(data, offset = 0) {
  if (data.length < offset + 14) return null;

  const dstMac = formatMac(data, offset);
  const srcMac = formatMac(data, offset + 6);
  const ethertype = (data[offset + 12] << 8) | data[offset + 13];

  return {
    layer: 2,
    name: 'Ethernet II',
    fields: {
      dst_mac: dstMac,
      src_mac: srcMac,
      ethertype: `0x${ethertype.toString(16).padStart(4, '0')}`,
      ethertype_name: ETHERTYPES[ethertype] || 'Unknown',
    },
    nextOffset: offset + 14,
    nextProtocol: ethertype,
  };
}

function formatMac(data, offset) {
  return Array.from(data.slice(offset, offset + 6))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(':');
}

const ETHERTYPES = {
  0x0800: 'IPv4',
  0x0806: 'ARP',
  0x86dd: 'IPv6',
  0x8915: 'RoCEv1',
};
