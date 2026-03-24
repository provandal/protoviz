export function dissectIPv6(data, offset) {
  if (data.length < offset + 40) return null;

  const vtcfl = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  const version = vtcfl >>> 28;
  if (version !== 6) return null;

  const trafficClass = (vtcfl >>> 20) & 0xff;
  const flowLabel = vtcfl & 0xfffff;
  const payloadLength = (data[offset + 4] << 8) | data[offset + 5];
  const nextHeader = data[offset + 6];
  const hopLimit = data[offset + 7];
  const srcIp = formatIPv6(data, offset + 8);
  const dstIp = formatIPv6(data, offset + 24);

  // Skip extension headers to find the upper-layer protocol
  let ulpNextHeader = nextHeader;
  let ulpOffset = offset + 40;
  while (EXTENSION_HEADERS.has(ulpNextHeader)) {
    if (data.length < ulpOffset + 8) break;
    const extNext = data[ulpOffset];
    const extLen = (data[ulpOffset + 1] + 1) * 8;
    ulpNextHeader = extNext;
    ulpOffset += extLen;
  }

  return {
    layer: 3,
    name: 'IPv6',
    fields: {
      version,
      traffic_class: `0x${trafficClass.toString(16).padStart(2, '0')}`,
      flow_label: `0x${flowLabel.toString(16).padStart(5, '0')}`,
      payload_length: payloadLength,
      next_header: ulpNextHeader,
      protocol_name: IPV6_NEXT_HEADERS[ulpNextHeader] || `Unknown (${ulpNextHeader})`,
      hop_limit: hopLimit,
      src_ip: srcIp,
      dst_ip: dstIp,
    },
    nextOffset: ulpOffset,
    nextProtocol: ulpNextHeader,
  };
}

export function dissectICMPv6(data, offset) {
  if (data.length < offset + 4) return null;

  const type = data[offset];
  const code = data[offset + 1];
  const checksum = (data[offset + 2] << 8) | data[offset + 3];

  const fields = {
    type,
    type_name: ICMPV6_TYPES[type] || `Type ${type}`,
    code,
    checksum: `0x${checksum.toString(16).padStart(4, '0')}`,
  };

  // Parse target address for NS/NA (types 135, 136)
  if ((type === 135 || type === 136) && data.length >= offset + 24) {
    fields.target_address = formatIPv6(data, offset + 8);
  }

  return {
    layer: 4,
    name: 'ICMPv6',
    fields,
    nextOffset: offset + 4,
  };
}

function formatIPv6(data, offset) {
  const groups = [];
  for (let i = 0; i < 8; i++) {
    groups.push(((data[offset + i * 2] << 8) | data[offset + i * 2 + 1]).toString(16));
  }
  // Compress longest run of zero groups
  const full = groups.join(':');
  let best = '', bestLen = 0, cur = '', curLen = 0, curStart = -1;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; best = curStart; }
    } else {
      curLen = 0;
    }
  }
  if (bestLen >= 2) {
    const before = groups.slice(0, best).join(':');
    const after = groups.slice(best + bestLen).join(':');
    return `${before}::${after}`;
  }
  return full;
}

const EXTENSION_HEADERS = new Set([0, 43, 44, 50, 51, 60, 135, 139, 140, 253, 254]);

const IPV6_NEXT_HEADERS = {
  0: 'Hop-by-Hop Options',
  6: 'TCP',
  17: 'UDP',
  43: 'Routing',
  44: 'Fragment',
  50: 'ESP',
  51: 'AH',
  58: 'ICMPv6',
  59: 'No Next Header',
  60: 'Destination Options',
};

const ICMPV6_TYPES = {
  1: 'Destination Unreachable',
  2: 'Packet Too Big',
  3: 'Time Exceeded',
  4: 'Parameter Problem',
  128: 'Echo Request',
  129: 'Echo Reply',
  130: 'Multicast Listener Query',
  131: 'Multicast Listener Report',
  133: 'Router Solicitation',
  134: 'Router Advertisement',
  135: 'Neighbor Solicitation',
  136: 'Neighbor Advertisement',
  137: 'Redirect',
};
