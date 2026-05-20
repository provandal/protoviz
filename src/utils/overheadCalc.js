/**
 * Frame overhead / goodput math.
 *
 * Pure functions — no React, no DOM. Given a frame definition, a link
 * variant, and (payload_bytes, message_bytes), compute frame count,
 * per-layer overhead breakdown, goodput %, and time-on-wire.
 */

/**
 * Sum the fixed-size fields (non-payload, non-wire-only) of a frame.
 * Returns bytes.
 */
export function frameBodyFixedBytes(frame) {
  if (!frame?.fields) return 0;
  let bits = 0;
  for (const f of frame.fields) {
    if (f.payload || f.variable) continue;
    if (f.wire_only) continue;
    bits += f.bits || 0;
  }
  return bits / 8;
}

/**
 * Sum the wire-only fields (Preamble, SFD, IFG, FC IDLEs).
 */
export function wireOnlyBytes(frame) {
  if (!frame?.fields) return 0;
  let bits = 0;
  for (const f of frame.fields) {
    if (f.wire_only) bits += f.bits || 0;
  }
  const extra = (frame.wire_overhead && frame.wire_overhead.before_bytes) || 0;
  return bits / 8 + extra;
}

/** Max user-data bytes per frame (per spec). */
export function maxPayloadPerFrame(frame, jumbo = false) {
  if (!frame?.payload) return Infinity;
  if (jumbo && frame.payload.jumbo_max_bytes) return frame.payload.jumbo_max_bytes;
  return frame.payload.max_bytes ?? Infinity;
}

/**
 * Bits per symbol on the line (NRZ = 1, PAM4 = 2).
 * Derive from the encoding string heuristically.
 */
function bitsPerSymbol(variant) {
  if (variant.bits_per_symbol) return variant.bits_per_symbol;
  const enc = (variant.encoding || '').toLowerCase();
  if (enc.includes('pam4')) return 2;
  return 1;
}

/**
 * Number of physical SerDes lanes the variant uses. Explicit `lanes`
 * field wins; otherwise inferred from the variant id (Ethernet naming
 * convention: 40GbE=4×10, 100GbE=4×25, 200GbE=4×PAM4, 400GbE=8×PAM4,
 * 800GbE=8×PAM4). FC tiers are single-lane through 128GFC.
 */
function laneCount(variant) {
  if (variant.lanes) return variant.lanes;
  const id = (variant.id || '').toLowerCase();
  if (id === '40gbe') return 4;
  if (id === '100gbe') return 4;
  if (id === '200gbe') return 4;
  if (id === '400gbe') return 8;
  if (id === '800gbe') return 8;
  return 1;
}

/**
 * Post-FEC rate in Gbps — the aggregate bit rate that survives PHY-layer
 * encoding and FEC overhead, across all SerDes lanes. This is the
 * MAC-layer rate; it does NOT account for preamble/IFG, framing, or
 * protocol headers. For end-to-end user data throughput, multiply this
 * by `goodput` from computeOverhead().
 */
export function effectiveUserRateGbps(variant) {
  if (!variant) return 0;
  const symbols = variant.line_rate_gbaud || 0;
  const bps = bitsPerSymbol(variant);
  const enc = variant.encoding_ratio ?? 1;
  const fec = variant.fec_ratio ?? 1;
  const lanes = laneCount(variant);
  return symbols * bps * enc * fec * lanes;
}

/**
 * Number of lanes used by the variant (1 for single-lane PHYs).
 */
export function variantLanes(variant) {
  return variant ? laneCount(variant) : 1;
}

/**
 * Per-lane line bitrate (Gbps, before encoding/FEC).
 */
export function laneLineRateGbps(variant) {
  if (!variant) return 0;
  return (variant.line_rate_gbaud || 0) * bitsPerSymbol(variant);
}

/**
 * Compute the full overhead breakdown for sending `messageBytes` of user
 * data using `frame` on `variant`, where each frame carries
 * `payloadPerFrame` bytes of payload (capped at frame max).
 *
 * Returns:
 *   {
 *     frameCount, payloadPerFrame (clamped),
 *     bodyFixedBytes,   // per-frame fixed header+trailer
 *     wireOverheadBytes, // per-frame preamble+sfd+ifg
 *     payloadBytes,     // total payload (= messageBytes, or last-frame trimmed)
 *     totalFrameBytes,  // payload + headers + trailers (no preamble/ifg)
 *     totalWireBytes,   // includes preamble/sfd/ifg/primitives
 *     encodingExpansionBytes, // wire bytes added by encoding (e.g. 64b/66b)
 *     fecExpansionBytes,      // wire bytes added by FEC
 *     totalLineBytes,         // bytes actually transmitted on the line
 *     goodput,                // 0..1 (messageBytes / totalLineBytes)
 *     timeSec,                // total wall-clock time on the wire
 *     breakdown: { payload, framing, encoding, fec, wire } in bytes,
 *   }
 */
export function computeOverhead({
  frame,
  variant,
  messageBytes,
  payloadPerFrame,
  jumbo = false,
}) {
  if (!frame || !variant) return null;

  const bodyFixed = frameBodyFixedBytes(frame);
  const wireOnly = wireOnlyBytes(frame);
  const maxPayload = maxPayloadPerFrame(frame, jumbo);

  // Clamp payload-per-frame to spec
  const payloadPF = Math.max(
    frame.payload?.min_bytes ?? 0,
    Math.min(payloadPerFrame, maxPayload),
  );

  // Fixed-size control frames have no variable payload (max=0). They send
  // exactly one frame regardless of "message size"; goodput is by
  // definition 0 since there is no user data.
  const isControlFrame = payloadPF <= 0 || maxPayload <= 0;
  const frameCount = isControlFrame
    ? 1
    : Math.max(1, Math.ceil(messageBytes / payloadPF));

  // Last frame may carry less; for simplicity, sum exact bytes
  const totalPayload = isControlFrame ? 0 : messageBytes;
  const totalBodyFixed = bodyFixed * frameCount;
  const totalWireOnly = wireOnly * frameCount;

  // Bytes on the encoded/FEC'd line (before line-coding overhead)
  const totalFrameBytes = totalPayload + totalBodyFixed;
  const totalWireBytes = totalFrameBytes + totalWireOnly;

  // Line-coding expansion: payload+frame+wire bytes get inflated by
  // 1/encoding_ratio and then 1/fec_ratio.
  const enc = variant.encoding_ratio ?? 1;
  const fec = variant.fec_ratio ?? 1;
  const afterEncoding = totalWireBytes / enc;
  const afterFec = afterEncoding / fec;
  const encodingExpansion = afterEncoding - totalWireBytes;
  const fecExpansion = afterFec - afterEncoding;
  const totalLineBytes = afterFec;

  const goodput = totalLineBytes > 0 ? totalPayload / totalLineBytes : 0;

  const userRateGbps = effectiveUserRateGbps(variant);
  const timeSec = userRateGbps > 0
    ? (totalPayload * 8) / (userRateGbps * 1e9)
    : 0;

  return {
    frameCount,
    payloadPerFrame: payloadPF,
    bodyFixedBytes: bodyFixed,
    wireOverheadBytes: wireOnly,
    payloadBytes: totalPayload,
    totalFrameBytes,
    totalWireBytes,
    encodingExpansionBytes: encodingExpansion,
    fecExpansionBytes: fecExpansion,
    totalLineBytes,
    goodput,
    timeSec,
    breakdown: {
      payload: totalPayload,
      framing: totalBodyFixed,
      wire: totalWireOnly,
      encoding: encodingExpansion,
      fec: fecExpansion,
    },
  };
}

/** Format a byte count for display: "1.46 KB", "256 MB", "1.0 GB". */
export function formatBytes(n) {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 ** 3)).toFixed(2)} GB`;
}

/** Format seconds adaptively into ns/µs/ms/s. */
export function formatTime(s) {
  if (s < 1e-6) return `${(s * 1e9).toFixed(2)} ns`;
  if (s < 1e-3) return `${(s * 1e6).toFixed(2)} µs`;
  if (s < 1) return `${(s * 1e3).toFixed(2)} ms`;
  return `${s.toFixed(3)} s`;
}

/** Format a 0..1 ratio as a percentage with adaptive precision. */
export function formatPct(r) {
  const p = r * 100;
  if (p >= 99.99) return `${p.toFixed(3)}%`;
  if (p >= 1) return `${p.toFixed(2)}%`;
  return `${p.toFixed(3)}%`;
}
