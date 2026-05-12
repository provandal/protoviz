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
const BIT_WIDTH_PX = ROW_WIDTH_PX / BITS_PER_ROW;
const ROW_HEIGHT_PX = 48;
const PAYLOAD_ROW_HEIGHT_PX = 60;

function withAlpha(hex, a) { return `${hex}${a}`; }

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
        startByteIndex: Math.floor((segStart - startBit) / 8),
      });
    }
    bitPos = endBit + 1;
  }
  // Group segments by row
  const rowsMap = {};
  for (const seg of segments) {
    if (!rowsMap[seg.row]) rowsMap[seg.row] = [];
    rowsMap[seg.row].push(seg);
  }
  const maxRow = Object.keys(rowsMap).reduce((a, b) => Math.max(a, Number(b)), -1);
  const rows = [];
  for (let i = 0; i <= maxRow; i++) rows.push({ segments: rowsMap[i] || [] });
  return rows;
}

function BitRuler() {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${BITS_PER_ROW}, 1fr)`,
      width: ROW_WIDTH_PX,
      height: 18,
      color: '#475569',
      fontSize: 8,
      fontFamily: 'monospace',
      borderBottom: '1px solid #1e293b',
    }}>
      {Array.from({ length: BITS_PER_ROW }, (_, i) => (
        <div key={i} style={{
          textAlign: 'center',
          borderRight: (i + 1) % 8 === 0 ? '1px solid #334155' : 'none',
          lineHeight: '18px',
        }}>
          {i % 4 === 0 ? i : ''}
        </div>
      ))}
    </div>
  );
}

function FieldSegment({ seg, totalFieldBytes, endianLE, expandedField, onClick, crcHighlight }) {
  const f = seg.field;
  const color = COLOR_MAP[f.color] || '#64748b';
  const isExpanded = expandedField === f.name;
  const isReserved = f.is_reserved;
  const highlighted = crcHighlight && crcHighlight.has(f.name);

  // Byte labels inside multi-byte segments: helps the endianness story.
  const widthBits = seg.endCol - seg.startCol + 1;
  const showByteLabels = totalFieldBytes >= 2 && widthBits >= 8;
  const byteLabels = showByteLabels
    ? Array.from({ length: Math.floor(widthBits / 8) }, (_, i) => {
        const seqByte = seg.startByteIndex + i;
        const labelIndex = endianLE ? (totalFieldBytes - 1 - seqByte) : seqByte;
        return `B${labelIndex}`;
      })
    : null;

  return (
    <div
      onClick={() => f.notes && onClick(f.name)}
      title={f.notes || undefined}
      style={{
        gridColumn: `${seg.startCol + 1} / ${seg.endCol + 2}`,
        background: highlighted
          ? withAlpha(color, '55')
          : isReserved
            ? `repeating-linear-gradient(45deg, ${color}44, ${color}44 4px, transparent 4px, transparent 8px)`
            : withAlpha(color, '33'),
        border: `1px solid ${withAlpha(color, highlighted ? 'ff' : '88')}`,
        boxShadow: highlighted ? `0 0 0 2px ${color}aa inset` : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: f.notes ? 'pointer' : 'default',
        position: 'relative',
        minHeight: 0,
      }}
    >
      {showByteLabels && (
        <div style={{
          position: 'absolute', top: 1, left: 2, right: 2,
          display: 'flex', justifyContent: 'space-around',
          fontSize: 7, color: withAlpha(color, 'aa'),
          fontFamily: 'monospace', pointerEvents: 'none',
        }}>
          {byteLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      )}
      {seg.isFirstSegment ? (
        <>
          <div style={{
            color: '#e2e8f0', fontSize: 11, fontWeight: 700,
            lineHeight: 1.2, textAlign: 'center', padding: '0 4px',
          }}>
            {f.name}
          </div>
          <div style={{ color: withAlpha(color, 'cc'), fontSize: 8, fontFamily: 'monospace' }}>
            {f.bits}b
            {f.is_crc && ' · CRC'}
          </div>
        </>
      ) : (
        <div style={{ color: '#475569', fontSize: 9 }}>·&nbsp;·&nbsp;·</div>
      )}
      {isExpanded && f.notes && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
          marginTop: 4, padding: '6px 8px',
          background: '#0a0f1a', border: `1px solid ${color}66`,
          borderRadius: 4, color: '#cbd5e1', fontSize: 10, lineHeight: 1.45,
          maxWidth: 360, textAlign: 'left',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          {f.notes}
        </div>
      )}
    </div>
  );
}

function FrameRow({ row, fieldsByName, endianLE, expandedField, onFieldClick, crcHighlight }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${BITS_PER_ROW}, 1fr)`,
      width: ROW_WIDTH_PX,
      height: ROW_HEIGHT_PX,
      position: 'relative',
    }}>
      {row.segments.map((seg, i) => {
        const totalFieldBytes = Math.floor(seg.field.bits / 8);
        return (
          <FieldSegment
            key={i}
            seg={seg}
            totalFieldBytes={totalFieldBytes}
            endianLE={endianLE}
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
        border: `1px solid ${withAlpha(color, highlighted ? 'ff' : '88')}`,
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
        textAlign: 'center', fontSize: 8, color: withAlpha(color, 'aa'),
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

function LayerRibbon({ rowCount, color, label }) {
  return (
    <div style={{
      position: 'absolute', left: -28, top: 0, bottom: 0, width: 24,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
      fontSize: 9, color, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      borderInlineStart: `3px solid ${color}`,
      paddingInlineStart: 6,
    }}>
      {label}
    </div>
  );
}

/**
 * Compute which fields are covered by which CRC field's coverage range.
 * Returns a Map { crcFieldName → Set<coveredFieldName> }.
 */
function computeCrcCoverage(fields) {
  const result = new Map();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
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

/** Wire-time strip — proportional widths by ns at selected link rate. */
function WireTimeStrip({ frame, variant, payloadBytes }) {
  const laneBps = laneLineRateGbps(variant) * 1e9; // bits per second
  const fields = frame.fields || [];
  // Compute total time
  const fieldsWithTime = fields.map(f => {
    const bits = f.payload ? payloadBytes * 8 : (f.bits || 0);
    return { f, bits };
  });
  const totalBits = fieldsWithTime.reduce((s, x) => s + x.bits, 0);
  const totalTimeSec = totalBits / laneBps;
  const totalTimeNs = totalTimeSec * 1e9;

  return (
    <div style={{ width: ROW_WIDTH_PX, marginTop: 8 }}>
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
              background: withAlpha(c, '88'),
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

  // Split: pre-payload, payload (single special row), post-payload
  const payloadIdx = fields.findIndex(f => f.payload || f.variable);
  const preFields = payloadIdx >= 0 ? fields.slice(0, payloadIdx) : fields;
  const payloadField = payloadIdx >= 0 ? fields[payloadIdx] : null;
  const postFields = payloadIdx >= 0 ? fields.slice(payloadIdx + 1) : [];

  const preLayout = useMemo(() => layoutFields(preFields), [preFields]);
  const postLayout = useMemo(() => layoutFields(postFields), [postFields]);

  const handleFieldClick = (name) => {
    setExpandedField(prev => (prev === name ? null : name));
    const f = fieldsByName[name];
    if (f && f.is_crc) {
      setActiveCrc(prev => (prev === name ? null : name));
    } else {
      // Clicking a non-CRC field clears CRC highlight
      setActiveCrc(null);
    }
  };

  const crcHighlight = activeCrc ? crcCoverageMap.get(activeCrc) : null;

  return (
    <div style={{ display: 'inline-block', position: 'relative' }}>
      <BitRuler />
      {preLayout.map((row, i) => (
        <FrameRow
          key={`pre-${i}`}
          row={row}
          fieldsByName={fieldsByName}
          endianLE={endianLE}
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
      {postLayout.map((row, i) => (
        <FrameRow
          key={`post-${i}`}
          row={row}
          fieldsByName={fieldsByName}
          endianLE={endianLE}
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
          marginTop: 6, padding: '4px 8px',
          background: '#0c2a36', border: '1px solid #22d3ee44',
          borderRadius: 3, fontSize: 10, color: '#22d3ee',
          maxWidth: ROW_WIDTH_PX,
        }}>
          ⚠ Viewing as little-endian host memory — byte numbers within each
          multi-byte field are reversed vs. their wire (big-endian) order.
        </div>
      )}
    </div>
  );
}

export { COLOR_MAP };
