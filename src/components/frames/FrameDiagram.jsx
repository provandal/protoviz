import { useState, useMemo } from 'react';
import { formatBytes, laneLineRateGbps } from '../../utils/overheadCalc';

const COLOR_MAP = {
  framing:    '#475569', // slate-600 — primitives, preamble, IFG
  addressing: '#06b6d4', // cyan — MACs, FC addresses
  control:    '#f59e0b', // amber — EtherType, R_CTL, F_CTL, EH flags
  payload:    '#10b981', // emerald — user data
  crc:        '#ec4899', // pink — FCS / CRC
  reserved:   '#334155', // slate-700 — reserved bits (hatched)
};

const BITS_PER_ROW = 32;
const ROW_WIDTH_PX = 720;
const ROW_HEIGHT_PX = 52;
const PAYLOAD_ROW_HEIGHT_PX = 64;

function withAlpha(hex, a) { return `${hex}${a}`; }

/**
 * Walk fields sequentially and split each into per-row segments.
 * Returns { rows: [{ segments }], finalBitPos }.
 */
function layoutFields(fields) {
  let bitPos = 0;
  const segments = [];
  for (const field of fields) {
    const bits = field.bits || 0;
    if (bits === 0) continue;
    const startBit = bitPos;
    const endBit = bitPos + bits - 1;
    const startRow = Math.floor(startBit / BITS_PER_ROW);
    const endRow = Math.floor(endBit / BITS_PER_ROW);
    for (let r = startRow; r <= endRow; r++) {
      const segStart = r === startRow ? startBit : r * BITS_PER_ROW;
      const segEnd = r === endRow ? endBit : r * BITS_PER_ROW + BITS_PER_ROW - 1;
      segments.push({
        field,
        row: r,
        startCol: segStart % BITS_PER_ROW,
        endCol: segEnd % BITS_PER_ROW,
        isFirstSegment: r === startRow,
        // Bit offset within this segment relative to field start (for byte
        // numbering across multi-segment fields).
        fieldOffsetStartBit: segStart - startBit,
      });
    }
    bitPos = endBit + 1;
  }
  const rowsMap = {};
  for (const seg of segments) {
    if (!rowsMap[seg.row]) rowsMap[seg.row] = [];
    rowsMap[seg.row].push(seg);
  }
  const maxRow = Object.keys(rowsMap).reduce((a, b) => Math.max(a, Number(b)), -1);
  const rows = [];
  for (let i = 0; i <= maxRow; i++) rows.push({ segments: rowsMap[i] || [] });
  return { rows, finalBitPos: bitPos };
}

/** Apply byte-0-right mirroring to a segment's column range. */
function mirrorCols(seg, mirror) {
  if (!mirror) return seg;
  return {
    ...seg,
    startCol: BITS_PER_ROW - 1 - seg.endCol,
    endCol: BITS_PER_ROW - 1 - seg.startCol,
    _mirrored: true,
  };
}

function BitRuler({ mirror }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${BITS_PER_ROW}, 1fr)`,
      width: ROW_WIDTH_PX,
      height: 18,
      color: '#94a3b8',
      fontSize: 9,
      fontFamily: 'monospace',
      borderBottom: '1px solid #1e293b',
      fontWeight: 600,
    }}>
      {Array.from({ length: BITS_PER_ROW }, (_, i) => {
        const bit = mirror ? (BITS_PER_ROW - 1 - i) : i;
        return (
          <div key={i} style={{
            textAlign: 'center',
            borderRight: (i + 1) % 8 === 0 ? '1px solid #334155' : 'none',
            lineHeight: '18px',
          }}>
            {bit % 4 === 0 ? bit : ''}
          </div>
        );
      })}
    </div>
  );
}

/**
 * For a multi-byte-aligned field, return the byte labels appearing in this
 * segment, with optional endian (LE) and FC-spec (mirror) flips.
 */
function computeByteLabels({ field, seg, endianLE, mirror }) {
  const totalBytes = Math.floor((field.bits || 0) / 8);
  if (totalBytes < 1) return null;
  if ((field.bits || 0) % 8 !== 0) return null;
  const widthBits = seg.endCol - seg.startCol + 1;
  if (widthBits < 8) return null;
  // Bytes in this segment in physical left-to-right order.
  const segByteCount = Math.floor(widthBits / 8);
  const startByteInField = Math.floor(seg.fieldOffsetStartBit / 8);
  // Logical byte index (under current view) for each physical position L->R.
  // Without any flips: physical[i] = startByteInField + i (counting from MSB)
  // With mirror only: spec convention flips direction within a word; for
  // multi-row fields, we reverse byte index within the segment so the
  // rightmost byte gets the lowest label.
  // With LE only: reverse labels across the WHOLE field.
  // With both: combine.
  let labels = Array.from({ length: segByteCount }, (_, i) => startByteInField + i);
  if (mirror) labels = labels.slice().reverse();
  if (endianLE) labels = labels.map(b => totalBytes - 1 - b);
  return labels;
}

function FieldSegment({ seg, field, endianLE, mirror, expandedField, onClick, crcHighlight }) {
  const color = COLOR_MAP[field.color] || '#64748b';
  const isExpanded = expandedField === field.name;
  const isReserved = field.is_reserved;
  const highlighted = crcHighlight && crcHighlight.has(field.name);

  const byteLabels = computeByteLabels({ field, seg, endianLE, mirror });
  const segByteCount = byteLabels?.length || 0;

  return (
    <div
      onClick={() => field.notes && onClick(field.name)}
      title={field.notes || undefined}
      style={{
        gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
        background: highlighted
          ? withAlpha(color, '55')
          : isReserved
            ? `repeating-linear-gradient(45deg, ${color}55, ${color}55 4px, transparent 4px, transparent 8px)`
            : withAlpha(color, '33'),
        border: `1px solid ${withAlpha(color, highlighted ? 'ff' : '99')}`,
        boxShadow: highlighted ? `0 0 0 2px ${color}aa inset` : undefined,
        cursor: field.notes ? 'pointer' : 'default',
        position: 'relative',
        minHeight: 0,
      }}
    >
      {/* Byte sub-cells: thin dashed dividers + tiny corner labels.
          Pointer-events: none so clicks fall through to the outer cell. */}
      {byteLabels && segByteCount > 1 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${segByteCount}, 1fr)`,
          pointerEvents: 'none',
        }}>
          {byteLabels.map((label, i) => (
            <div key={i} style={{
              borderInlineEnd: i < segByteCount - 1
                ? `1px dashed ${withAlpha(color, '66')}`
                : 'none',
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute', top: 2, insetInlineStart: 3,
                fontSize: 8, color: withAlpha(color, 'dd'),
                fontFamily: 'monospace', fontWeight: 700,
                letterSpacing: '0.03em',
              }}>
                B{label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Field name + bit count centered. */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100%', pointerEvents: 'none',
      }}>
        {seg.isFirstSegment ? (
          <>
            <div style={{
              color: '#e2e8f0', fontSize: 11, fontWeight: 700,
              lineHeight: 1.2, textAlign: 'center', padding: '0 4px',
            }}>
              {field.name}
            </div>
            <div style={{ color: withAlpha(color, 'cc'), fontSize: 8, fontFamily: 'monospace' }}>
              {field.bits}b{field.is_crc && ' · CRC'}
            </div>
          </>
        ) : (
          <div style={{ color: '#475569', fontSize: 9 }}>·&nbsp;·&nbsp;·</div>
        )}
      </div>

      {isExpanded && field.notes && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          marginTop: 4, padding: '6px 8px',
          background: '#0a0f1a', border: `1px solid ${color}66`,
          borderRadius: 4, color: '#cbd5e1', fontSize: 10, lineHeight: 1.45,
          maxWidth: 360, textAlign: 'left',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {field.notes}
        </div>
      )}
    </div>
  );
}

function FrameRow({ row, endianLE, mirror, expandedField, onFieldClick, crcHighlight, height = ROW_HEIGHT_PX }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${BITS_PER_ROW}, 1fr)`,
      width: ROW_WIDTH_PX,
      height,
      position: 'relative',
    }}>
      {row.segments.map((seg, i) => {
        const drawSeg = mirrorCols(seg, mirror);
        return (
          <FieldSegment
            key={i}
            seg={drawSeg}
            field={seg.field}
            endianLE={endianLE}
            mirror={mirror}
            expandedField={expandedField}
            onClick={onFieldClick}
            crcHighlight={crcHighlight}
          />
        );
      })}
    </div>
  );
}

function PayloadRow({ field, bytes, expandedField, onFieldClick, crcHighlight }) {
  const color = COLOR_MAP.payload;
  const isExpanded = expandedField === field.name;
  const highlighted = crcHighlight && crcHighlight.has(field.name);
  return (
    <div
      onClick={() => field.notes && onFieldClick(field.name)}
      title={field.notes || undefined}
      style={{
        width: ROW_WIDTH_PX,
        height: PAYLOAD_ROW_HEIGHT_PX,
        background: highlighted ? withAlpha(color, '55') : withAlpha(color, '22'),
        border: `1px solid ${withAlpha(color, highlighted ? 'ff' : '99')}`,
        borderLeft: `4px solid ${color}`,
        borderRight: `4px solid ${color}`,
        boxShadow: highlighted ? `0 0 0 2px ${color}aa inset` : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: field.notes ? 'pointer' : 'default',
        position: 'relative',
      }}
    >
      <div style={{
        position: 'absolute', top: 4, left: 0, right: 0,
        textAlign: 'center', fontSize: 8, color: withAlpha(color, 'cc'),
        fontFamily: 'monospace',
      }}>
        — variable — {formatBytes(bytes)} —
      </div>
      <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 700 }}>
        {field.name}
      </div>
      {isExpanded && field.notes && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          marginTop: 4, padding: '6px 8px',
          background: '#0a0f1a', border: `1px solid ${color}66`,
          borderRadius: 4, color: '#cbd5e1', fontSize: 10, lineHeight: 1.45,
          textAlign: 'left',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {field.notes}
        </div>
      )}
    </div>
  );
}

/**
 * Compute which fields each CRC field covers. Map { crcName → Set<fieldName> }.
 */
function computeCrcCoverage(fields) {
  const result = new Map();
  for (const f of fields) {
    if (!f.is_crc || !f.crc_coverage) continue;
    const fromIdx = fields.findIndex(x => x.name === f.crc_coverage.from);
    const toIdx = fields.findIndex(x => x.name === f.crc_coverage.to);
    if (fromIdx < 0 || toIdx < 0) continue;
    const covered = new Set();
    for (let j = fromIdx; j <= toIdx; j++) covered.add(fields[j].name);
    result.set(f.name, covered);
  }
  return result;
}

function WireTimeStrip({ frame, variant, payloadBytes }) {
  const laneBps = laneLineRateGbps(variant) * 1e9;
  const fields = frame.fields || [];
  const fieldsWithTime = fields.map(f => {
    const bits = f.payload ? payloadBytes * 8 : (f.bits || 0);
    return { f, bits };
  });
  const totalBits = fieldsWithTime.reduce((s, x) => s + x.bits, 0);
  const totalTimeSec = totalBits / laneBps;
  const totalTimeNs = totalTimeSec * 1e9;
  return (
    <div style={{ width: ROW_WIDTH_PX, marginTop: 12 }}>
      <div style={{
        color: '#94a3b8', fontSize: 9, marginBottom: 4,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        Wire time @ {variant.name} — {totalTimeNs.toFixed(2)} ns total
      </div>
      <div style={{
        display: 'flex', width: ROW_WIDTH_PX, height: 22,
        border: '1px solid #1e293b', borderRadius: 3, overflow: 'hidden',
      }}>
        {fieldsWithTime.map(({ f, bits }, i) => {
          const c = COLOR_MAP[f.color] || '#64748b';
          const widthPct = totalBits > 0 ? (bits / totalBits) * 100 : 0;
          if (widthPct === 0) return null;
          return (
            <div key={i} title={`${f.name}: ${(bits / laneBps * 1e9).toFixed(2)} ns`} style={{
              width: `${widthPct}%`,
              background: withAlpha(c, '99'),
              borderRight: i < fieldsWithTime.length - 1 ? '1px solid #020817' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#020817', fontSize: 8, fontWeight: 700,
              overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              {widthPct > 4 ? f.name : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FrameDiagram({
  frame,
  variant,
  payloadBytes,
  endianLE = false,
  wireTime = false,
}) {
  const [expandedField, setExpandedField] = useState(null);
  const [activeCrc, setActiveCrc] = useState(null);

  const fields = useMemo(() => frame.fields || [], [frame]);
  const fieldsByName = useMemo(() => {
    const m = {};
    for (const f of fields) m[f.name] = f;
    return m;
  }, [fields]);
  const crcCoverageMap = useMemo(() => computeCrcCoverage(fields), [fields]);

  // FC draws byte 0 on the right; renderer mirrors horizontal column layout.
  const mirror = frame.byte_order === 'byte-0-right';

  // Split into pre-payload, payload, post-payload
  const payloadIdx = fields.findIndex(f => f.payload || f.variable);
  const preFields = payloadIdx >= 0 ? fields.slice(0, payloadIdx) : fields;
  const payloadField = payloadIdx >= 0 ? fields[payloadIdx] : null;
  const postFields = payloadIdx >= 0 ? fields.slice(payloadIdx + 1) : [];

  const preLayout = useMemo(() => layoutFields(preFields), [preFields]);
  const postLayout = useMemo(() => layoutFields(postFields), [postFields]);

  // Lead-in: if pre-fields end mid-row, payload fills the remaining columns
  // of that row instead of starting a fresh row below (which creates a
  // visible gap — e.g., after EtherType for Ethernet/ESUN).
  const lastPreBit = preLayout.finalBitPos; // bit pos just after last pre field
  const leadInStartBit = lastPreBit % BITS_PER_ROW;
  const hasLeadIn = leadInStartBit !== 0 && payloadField;

  // Mutate (locally) the last pre-row to include the lead-in segment.
  const preRowsWithLeadIn = useMemo(() => {
    if (!hasLeadIn) return preLayout.rows;
    const rows = preLayout.rows.map(r => ({ segments: [...r.segments] }));
    const lastIdx = rows.length - 1;
    if (lastIdx < 0) return rows;
    rows[lastIdx].segments.push({
      field: payloadField,
      row: lastIdx,
      startCol: leadInStartBit,
      endCol: BITS_PER_ROW - 1,
      isFirstSegment: false, // not the "header" segment — payload's main row carries the label
      fieldOffsetStartBit: 0,
      isLeadIn: true,
    });
    return rows;
  }, [preLayout, hasLeadIn, leadInStartBit, payloadField]);

  const handleFieldClick = (name) => {
    setExpandedField(prev => (prev === name ? null : name));
    const f = fieldsByName[name];
    if (f && f.is_crc) setActiveCrc(prev => (prev === name ? null : name));
    else setActiveCrc(null);
  };

  const crcHighlight = activeCrc ? crcCoverageMap.get(activeCrc) : null;

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <div style={{
        color: '#475569', fontSize: 9, fontFamily: 'monospace',
        marginBottom: 2, letterSpacing: '0.05em',
      }}>
        {mirror
          ? 'bit 31 ←——— bit position ———→ bit 0   (byte 0 on the right, per FC spec)'
          : 'bit 0 ←——— bit position ———→ bit 31   (byte 0 on the left, per IETF)'}
      </div>
      <BitRuler mirror={mirror} />
      {preRowsWithLeadIn.map((row, i) => (
        <FrameRow
          key={`pre-${i}`}
          row={row}
          endianLE={endianLE}
          mirror={mirror}
          expandedField={expandedField}
          onFieldClick={handleFieldClick}
          crcHighlight={crcHighlight}
        />
      ))}
      {payloadField && (
        <PayloadRow
          field={payloadField}
          bytes={payloadBytes}
          expandedField={expandedField}
          onFieldClick={handleFieldClick}
          crcHighlight={crcHighlight}
        />
      )}
      {postLayout.rows.map((row, i) => (
        <FrameRow
          key={`post-${i}`}
          row={row}
          endianLE={endianLE}
          mirror={mirror}
          expandedField={expandedField}
          onFieldClick={handleFieldClick}
          crcHighlight={crcHighlight}
        />
      ))}
      {wireTime && variant && (
        <WireTimeStrip frame={frame} variant={variant} payloadBytes={payloadBytes} />
      )}
      {endianLE && (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: '#0c2a36', border: '1px solid #22d3ee44',
          borderRadius: 3, fontSize: 10, color: '#22d3ee', lineHeight: 1.5,
          maxWidth: ROW_WIDTH_PX,
        }}>
          <strong>Host (LE) byte order.</strong>{' '}
          On the wire, bytes transmit in network byte order — byte 0
          (MSB) first. On a little-endian host (x86/ARM), the same
          multi-byte integer in memory has its bytes byte-swapped:
          byte 0 ends up at the lowest address being the LSB. Byte
          labels reflect this LE memory-order numbering.
        </div>
      )}
      {!endianLE && (
        <div style={{
          marginTop: 8, padding: '6px 10px',
          background: '#0a0f1a', border: '1px solid #1e293b',
          borderRadius: 3, fontSize: 10, color: '#64748b', lineHeight: 1.5,
          maxWidth: ROW_WIDTH_PX,
        }}>
          <strong>Network (wire) byte order.</strong>{' '}
          Bytes are labeled in transmission order. Byte 0 is the first
          byte to leave the transmitter and the first byte to arrive at
          the receiver.
        </div>
      )}
    </div>
  );
}

export { COLOR_MAP };
