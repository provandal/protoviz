import { useMemo } from 'react';
import useViewerStore from '../../store/viewerStore';
import { PHASE_COLORS } from '../../utils/constants';

export default function PlaybackControls({ total, phaseColor }) {
  const step = useViewerStore(s => s.step);
  const playing = useViewerStore(s => s.playing);
  const goToStep = useViewerStore(s => s.goToStep);
  const togglePlay = useViewerStore(s => s.togglePlay);
  const scenario = useViewerStore(s => s.scenario);

  // Only show phases that exist in the current scenario's timeline
  const scenarioPhases = useMemo(() => {
    if (!scenario?.timeline) return [];
    const seen = new Set();
    const ordered = [];
    for (const ev of scenario.timeline) {
      if (ev.phase && !seen.has(ev.phase)) {
        seen.add(ev.phase);
        ordered.push(ev.phase);
      }
    }
    return ordered;
  }, [scenario]);

  return (
    <div className="pvz-playback" style={{ padding: '8px 12px', background: '#0a0f1a', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
      <input
        type="range" min={0} max={total - 1} value={step}
        onChange={e => goToStep(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: phaseColor, marginBottom: 8 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { label: '\u23EE', fn: () => goToStep(0) },
            { label: '\u25C0', fn: () => goToStep(step - 1) },
            { label: playing ? '\u23F8' : '\u25B6', fn: togglePlay },
            { label: '\u25B6', fn: () => goToStep(step + 1) },
            { label: '\u23ED', fn: () => goToStep(total - 1) },
          ].map((b, i) => (
            <button key={i} onClick={b.fn} style={{
              background: '#1e293b', border: 'none', color: '#94a3b8',
              width: 28, height: 28, borderRadius: 4, cursor: 'pointer', fontSize: 12,
            }}>{b.label}</button>
          ))}
        </div>
        {/* Phase legend: hidden on mobile via CSS */}
        <div className="pvz-phase-legend" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {scenarioPhases.map(p => (
            <span key={p} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: PHASE_COLORS[p] || '#475569', display: 'inline-block' }} />
              <span style={{ color: '#475569', fontSize: 9 }}>{p}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
