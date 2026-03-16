/**
 * Client-side PCAP / pcapng file parser.
 *
 * Supports:
 *   - PCAP (magic 0xa1b2c3d4 / 0xd4c3b2a1)
 *   - pcapng (Section Header Block magic 0x0a0d0d0a)
 */

const PCAP_MAGIC_LE = 0xa1b2c3d4;
const PCAP_MAGIC_BE = 0xd4c3b2a1;
const PCAPNG_SHB_MAGIC = 0x0a0d0d0a;
const PCAPNG_BYTE_ORDER_MAGIC = 0x1a2b3c4d;

export function parsePcap(arrayBuffer, maxPackets = 500) {
  if (arrayBuffer.byteLength < 24) {
    throw new Error('File too small to be a valid capture file');
  }

  const view = new DataView(arrayBuffer);
  const magic = view.getUint32(0, true);

  // Check for pcapng: first block type is SHB (0x0a0d0d0a)
  if (magic === PCAPNG_SHB_MAGIC) {
    return parsePcapng(arrayBuffer, maxPackets);
  }

  // Legacy PCAP
  if (magic === PCAP_MAGIC_LE || magic === PCAP_MAGIC_BE) {
    return parseLegacyPcap(arrayBuffer, view, magic === PCAP_MAGIC_LE, maxPackets);
  }

  throw new Error('Not a valid capture file. Supported formats: PCAP, pcapng.');
}

// ── Legacy PCAP ──────────────────────────────────────────────────

function parseLegacyPcap(arrayBuffer, view, le, maxPackets) {
  const versionMajor = view.getUint16(4, le);
  const versionMinor = view.getUint16(6, le);
  const snapLen = view.getUint32(16, le);
  const linkType = view.getUint32(20, le);

  if (linkType !== 1) {
    throw new Error(`Unsupported link type: ${linkType}. Only Ethernet (1) is supported.`);
  }

  const header = { versionMajor, versionMinor, snapLen, linkType };
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
    packets.push({
      index: packets.length,
      timestamp: tsSec + tsUsec / 1e6,
      capturedLen,
      originalLen,
      data,
    });

    offset += capturedLen;
  }

  return { header, packets };
}

// ── pcapng ────────────────────────────────────────────────────────

function parsePcapng(arrayBuffer, maxPackets) {
  const view = new DataView(arrayBuffer);
  const len = arrayBuffer.byteLength;
  let offset = 0;
  let le = true; // byte order, determined from SHB
  const interfaces = []; // IDB entries: { linkType, tsResol }
  const packets = [];

  while (offset + 8 <= len && packets.length < maxPackets) {
    const blockType = view.getUint32(offset, le);
    const blockTotalLen = view.getUint32(offset + 4, le);

    if (blockTotalLen < 12 || offset + blockTotalLen > len) break;

    switch (blockType) {
      case 0x0a0d0d0a: // Section Header Block
        le = parseSHB(view, offset);
        break;

      case 0x00000001: // Interface Description Block
        interfaces.push(parseIDB(view, offset, le, blockTotalLen));
        break;

      case 0x00000006: // Enhanced Packet Block
        {
          const pkt = parseEPB(view, arrayBuffer, offset, le, interfaces, packets.length);
          if (pkt) packets.push(pkt);
        }
        break;

      case 0x00000003: // Simple Packet Block
        {
          const pkt = parseSPB(view, arrayBuffer, offset, le, interfaces, packets.length, blockTotalLen);
          if (pkt) packets.push(pkt);
        }
        break;

      // Skip other block types (Name Resolution, Statistics, etc.)
    }

    // Advance to next block (block total length includes both length fields)
    offset += blockTotalLen;
    // pcapng blocks are padded to 4-byte boundaries (already included in blockTotalLen)
  }

  if (packets.length === 0) {
    throw new Error('No packets found in pcapng file');
  }

  // Validate at least one Ethernet interface was found
  const hasEthernet = interfaces.some(i => i.linkType === 1);
  if (!hasEthernet && interfaces.length > 0) {
    const types = interfaces.map(i => i.linkType).join(', ');
    throw new Error(`Unsupported link type(s): ${types}. Only Ethernet (1) is supported.`);
  }

  return {
    header: {
      format: 'pcapng',
      interfaces: interfaces.length,
      linkType: interfaces[0]?.linkType || 1,
    },
    packets,
  };
}

function parseSHB(view, offset) {
  // Byte-Order Magic is at offset+12
  const bom = view.getUint32(offset + 12, true);
  if (bom === PCAPNG_BYTE_ORDER_MAGIC) {
    return true; // little-endian
  }
  // Try big-endian
  const bomBE = view.getUint32(offset + 12, false);
  if (bomBE === PCAPNG_BYTE_ORDER_MAGIC) {
    return false; // big-endian
  }
  // Default to LE
  return true;
}

function parseIDB(view, offset, le, blockTotalLen) {
  // IDB body starts at offset+8
  const linkType = view.getUint16(offset + 8, le);
  const snapLen = view.getUint32(offset + 12, le);

  // Parse options to find if_tsresol (option code 9)
  let tsResol = 6; // default: microseconds (10^-6)
  let optOffset = offset + 16;
  const optEnd = offset + blockTotalLen - 4; // subtract trailing block length

  while (optOffset + 4 <= optEnd) {
    const optCode = view.getUint16(optOffset, le);
    const optLen = view.getUint16(optOffset + 2, le);
    if (optCode === 0) break; // opt_endofopt

    if (optCode === 9 && optLen >= 1) {
      // if_tsresol
      const resol = view.getUint8(optOffset + 4);
      if (resol & 0x80) {
        // MSB set: value is power of 2
        tsResol = resol & 0x7f;
      } else {
        // MSB clear: value is power of 10
        tsResol = resol;
      }
    }

    optOffset += 4 + Math.ceil(optLen / 4) * 4; // padded to 4 bytes
  }

  return { linkType, snapLen, tsResol };
}

function parseEPB(view, arrayBuffer, offset, le, interfaces, index) {
  // EPB body: interfaceID(4) + tsHigh(4) + tsLow(4) + capturedLen(4) + originalLen(4) + data
  const interfaceId = view.getUint32(offset + 8, le);
  const tsHigh = view.getUint32(offset + 12, le);
  const tsLow = view.getUint32(offset + 16, le);
  const capturedLen = view.getUint32(offset + 20, le);
  const originalLen = view.getUint32(offset + 24, le);
  const dataOffset = offset + 28;

  // Check interface link type
  const iface = interfaces[interfaceId] || interfaces[0];
  if (!iface || iface.linkType !== 1) return null; // Only Ethernet

  if (dataOffset + capturedLen > arrayBuffer.byteLength) return null;

  // Compute timestamp
  const tsRaw = tsHigh * 0x100000000 + tsLow;
  const timestamp = convertTimestamp(tsRaw, iface.tsResol);

  const data = new Uint8Array(arrayBuffer, dataOffset, capturedLen);

  return {
    index,
    timestamp,
    capturedLen,
    originalLen,
    data,
  };
}

function parseSPB(view, arrayBuffer, offset, le, interfaces, index, blockTotalLen) {
  // SPB: originalLen(4) + data (captured = blockTotalLen - 16)
  const originalLen = view.getUint32(offset + 8, le);
  const capturedLen = blockTotalLen - 16; // 8 (header) + 4 (origLen) + 4 (trailing len)
  const dataOffset = offset + 12;

  const iface = interfaces[0];
  if (!iface || iface.linkType !== 1) return null;

  if (dataOffset + capturedLen > arrayBuffer.byteLength || capturedLen <= 0) return null;

  const data = new Uint8Array(arrayBuffer, dataOffset, capturedLen);

  return {
    index,
    timestamp: 0,
    capturedLen,
    originalLen,
    data,
  };
}

function convertTimestamp(tsRaw, tsResol) {
  // tsResol is the power of 10 (or 2 if MSB was set, handled in parseIDB)
  // Default: 6 → microseconds
  const divisor = Math.pow(10, tsResol);
  return tsRaw / divisor;
}
