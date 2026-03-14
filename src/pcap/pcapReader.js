/**
 * Client-side PCAP file parser.
 * Supports standard PCAP format (magic 0xa1b2c3d4 / 0xd4c3b2a1).
 * Does NOT support pcapng.
 */

const PCAP_MAGIC_LE = 0xa1b2c3d4;
const PCAP_MAGIC_BE = 0xd4c3b2a1;

export function parsePcap(arrayBuffer, maxPackets = 500) {
  const view = new DataView(arrayBuffer);

  if (arrayBuffer.byteLength < 24) {
    throw new Error('File too small to be a valid PCAP');
  }

  // Global header
  const magic = view.getUint32(0, true);
  let le;
  if (magic === PCAP_MAGIC_LE) {
    le = true;
  } else if (magic === PCAP_MAGIC_BE) {
    le = false;
  } else {
    throw new Error('Not a valid PCAP file (unsupported magic number). pcapng is not yet supported.');
  }

  const versionMajor = view.getUint16(4, le);
  const versionMinor = view.getUint16(6, le);
  const snapLen = view.getUint32(16, le);
  const linkType = view.getUint32(20, le);

  if (linkType !== 1) {
    throw new Error(`Unsupported link type: ${linkType}. Only Ethernet (1) is supported.`);
  }

  const header = { versionMajor, versionMinor, snapLen, linkType };
  const packets = [];
  let offset = 24; // Past global header

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
