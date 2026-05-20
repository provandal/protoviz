import { formatBytes, formatPct, formatTime, effectiveUserRateGbps } from '../../utils/overheadCalc';

const SEG_COLORS = {
  payload:  { c: '#10b981', label: 'Payload' },
  framing:  { c: '#06b6d4', label: 'Frame headers + trailers' },
  wire:     { c: '#475569', label: 'Wire overhead (Preamble/SFD/IFG)' },
  encoding: { c: '#f59e0b', label: 'Line encoding overhead' },
  fec:      { c: '#ec4899', label: 'FEC overhead' },
};

const ORDER = ['payload', 'framing', 'wire', 'encoding', 'fec'];

function withAlpha(hex, a) { return `${hex}${a}`; }

function Bar({ breakdown, totalLineBytes }) {
  if (!totalLineBytes) return null;
  return (
    <div style={{
      display: 'flex', width: '100%', height: 36,
      border: '1px solid #1e293b', borderRadius: 4, overflow: 'hidden',
    }}>
      {ORDER.map(key => {
        const bytes = breakdown[key] || 0;
        const pct = (bytes / totalLineBytes) * 100;
        if (pct === 0) return null;
        const { c, label } = SEG_COLORS[key];
        return (
          <div key={key} title={`${label}: ${formatBytes(bytes)} (${pct.toFixed(2)}%)`} style={{
            width: `${pct}%`,
            background: withAlpha(c, 'cc'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#020817', fontSize: 10, fontWeight: 700,
            overflow: 'hidden', whiteSpace: 'nowrap',
            borderRight: '1px solid #020817',
          }}>
            {pct > 6 ? `${pct.toFixed(1)}%` : ''}
          </div>
        );
      })}
    </div>
  );
}

function Legend({ breakdown, totalLineBytes }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8,
      fontSize: 10, color: '#94a3b8',
    }}>
      {ORDER.map(key => {
        const bytes = breakdown[key] || 0;
        const pct = totalLineBytes > 0 ? (bytes / totalLineBytes) * 100 : 0;
        const { c, label } = SEG_COLORS[key];
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 10, height: 10, borderRadius: 2,
              background: withAlpha(c, 'cc'),
            }} />
            <span>{label}</span>
            <span style={{ color: '#475569' }}>
              {formatBytes(bytes)} · {pct.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function OverheadWaterfall({ result, variant }) {
  if (!result || !variant) return null;
  const { breakdown, totalLineBytes, goodput, timeSec, frameCount } = result;
  const goodputGbps = effectiveUserRateGbps(variant) * goodput;
  return (
    <div style={{
      padding: 16,
      background: '#0a0f1a',
      border: '1px solid #1e293b',
      borderRadius: 8,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12, gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{
          color: '#94a3b8', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          Where the bandwidth goes
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 11, color: '#cbd5e1' }}>
          <div>
            Goodput:{' '}
            <span style={{ color: '#10b981', fontWeight: 700 }}>{formatPct(goodput)}</span>
            <span style={{ color: '#475569' }}> · </span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>{goodputGbps.toFixed(2)} Gbps</span>
          </div>
          <div>
            Time on wire:{' '}
            <span style={{ color: '#22d3ee', fontWeight: 700 }}>{formatTime(timeSec)}</span>
          </div>
          <div>
            Frames:{' '}
            <span style={{ color: '#a78bfa', fontWeight: 700 }}>{frameCount.toLocaleString()}</span>
          </div>
          <div>
            Total on wire:{' '}
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>{formatBytes(totalLineBytes)}</span>
          </div>
        </div>
      </div>
      <Bar breakdown={breakdown} totalLineBytes={totalLineBytes} />
      <Legend breakdown={breakdown} totalLineBytes={totalLineBytes} />
    </div>
  );
}
