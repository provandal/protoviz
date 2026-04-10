import { useTranslation } from 'react-i18next';

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ds = Math.floor((ms % 1000) / 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ds}`;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export default function NetSimControls({
  topology,
  playheadMs,
  durationMs,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onSeek,
  onSetSpeed,
  activeVariant,
  onSetVariant,
}) {
  const { t } = useTranslation();

  const pct = durationMs > 0 ? (playheadMs / durationMs) * 100 : 0;

  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
      padding: '12px 16px',
    }}>
      {/* Transport row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          onClick={() => onSeek(0)}
          title={t('netsim.restart')}
          style={transportButtonStyle}
        >
          {'\u23EE'}
        </button>
        <button
          onClick={isPlaying ? onPause : onPlay}
          style={{ ...transportButtonStyle, width: 38, fontSize: 14 }}
        >
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button
          onClick={() => onSeek(durationMs)}
          title={t('netsim.jumpToEnd')}
          style={transportButtonStyle}
        >
          {'\u23ED'}
        </button>

        {/* Scrubber */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              onSeek(ratio * durationMs);
            }}
            style={{
              flex: 1, height: 6, background: '#1e293b', borderRadius: 3,
              cursor: 'pointer', position: 'relative',
            }}
          >
            <div style={{
              position: 'absolute', top: 0, left: 0, bottom: 0,
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #3b82f6, #a78bfa)',
              borderRadius: 3,
              transition: isPlaying ? 'none' : 'width 0.15s',
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: `${pct}%`,
              width: 12, height: 12, borderRadius: '50%',
              background: '#e2e8f0',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              boxShadow: '0 0 0 2px #0f172a',
            }} />
          </div>
          <span style={{
            color: '#94a3b8', fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
            whiteSpace: 'nowrap', minWidth: 78, textAlign: 'end',
          }}>
            {formatTime(playheadMs)} / {formatTime(durationMs)}
          </span>
        </div>
      </div>

      {/* Speed row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: topology?.whatif_params?.length ? 10 : 0 }}>
        <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {t('netsim.speed')}
        </span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSetSpeed(s)}
            style={{
              ...speedButtonStyle,
              background: speed === s ? '#3b82f6' : '#1e293b',
              color: speed === s ? '#fff' : '#94a3b8',
              borderColor: speed === s ? '#3b82f6' : '#334155',
            }}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* What-if params */}
      {topology?.whatif_params?.map((param) => (
        <div key={param.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <span style={{ color: '#64748b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', minWidth: 48 }}>
            {param.label}
          </span>
          {param.type === 'enum' && param.options.map((opt) => (
            <button
              key={opt}
              onClick={() => onSetVariant({ ...activeVariant?.params, [param.id]: opt })}
              style={{
                ...speedButtonStyle,
                background: activeVariant?.params?.[param.id] === opt ? '#8b5cf6' : '#1e293b',
                color: activeVariant?.params?.[param.id] === opt ? '#fff' : '#94a3b8',
                borderColor: activeVariant?.params?.[param.id] === opt ? '#8b5cf6' : '#334155',
                textTransform: 'capitalize',
              }}
            >
              {opt}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {activeVariant?.description && (
            <span style={{ color: '#64748b', fontSize: 10, fontStyle: 'italic' }}>
              {activeVariant.description}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const transportButtonStyle = {
  background: '#1e293b', border: '1px solid #334155',
  color: '#e2e8f0', borderRadius: 6,
  padding: '6px 12px', cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
  minWidth: 32,
};

const speedButtonStyle = {
  background: '#1e293b', border: '1px solid #334155',
  color: '#94a3b8', borderRadius: 4,
  padding: '3px 10px', cursor: 'pointer',
  fontSize: 10, fontWeight: 700,
};
