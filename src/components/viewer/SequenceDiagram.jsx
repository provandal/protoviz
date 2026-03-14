import { useRef, useEffect, useMemo } from 'react';
import { PHASE_COLORS } from '../../utils/constants';
import useViewerStore from '../../store/viewerStore';

export default function SequenceDiagram({ timeline, currentStep, onStepSelect }) {
  const phases = [...new Set(timeline.map(e => e.phase))];
  const phaseGroups = phases.map(p => ({ phase: p, events: timeline.filter(e => e.phase === p) }));
  const currentRef = useRef(null);
  const slug = useViewerStore(s => s.currentSlug);

  // Read annotations from localStorage for note indicators
  const annotations = useMemo(() => {
    if (!slug) return {};
    try {
      const stored = localStorage.getItem(`protoviz_annotations_${slug}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }, [slug, currentStep]); // re-read when step changes (in case user added a note)

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentStep]);

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {phaseGroups.map(({ phase, events }) => (
        <div key={phase} style={{ marginBottom: 8 }}>
          <div style={{
            padding: '3px 10px', background: `${PHASE_COLORS[phase]}22`,
            borderLeft: `3px solid ${PHASE_COLORS[phase]}`,
            color: PHASE_COLORS[phase] || '#94a3b8', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>{phase}</div>
          {events.map(ev => {
            const idx = timeline.indexOf(ev);
            const isCurrent = idx === currentStep;
            const isPast = idx < currentStep;
            const hasNote = !!annotations[idx];
            const color = ev.color || '#475569';
            const isFrame = ev.type === 'frame_tx';
            const dir = isFrame ? (ev.from === 'initiator' ? 'right' : 'left') : null;
            return (
              <div
                key={ev.id}
                ref={isCurrent ? currentRef : undefined}
                onClick={() => onStepSelect(idx)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 0, padding: '5px 8px', cursor: 'pointer',
                  background: isCurrent ? `${color}18` : isPast ? '#0a0f1a' : 'transparent',
                  borderLeft: isCurrent ? `3px solid ${color}` : '3px solid transparent',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => !isCurrent && (e.currentTarget.style.background = '#0f172a')}
                onMouseLeave={e => !isCurrent && (e.currentTarget.style.background = isPast ? '#0a0f1a' : 'transparent')}
              >
                {/* Note indicator */}
                <div style={{ width: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {hasNote && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} title="Has note" />
                  )}
                </div>
                {/* Left actor column */}
                <div style={{ width: 70, display: 'flex', justifyContent: 'flex-end', paddingRight: 6 }}>
                  {isFrame && ev.from === 'initiator' && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>HOST A</span>
                  )}
                  {isFrame && ev.from === 'target' && dir === 'left' && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700, marginLeft: 'auto' }}>◀</span>
                  )}
                </div>
                {/* Arrow / label */}
                <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                  {isFrame ? (
                    <div style={{ position: 'relative' }}>
                      <div style={{
                        height: 1, background: isPast ? color + '44' : color,
                        margin: '8px 0', boxShadow: isCurrent ? `0 0 6px ${color}` : undefined,
                        transition: 'all 0.3s',
                      }} />
                      <div style={{
                        position: 'absolute',
                        [dir === 'right' ? 'right' : 'left']: 0,
                        top: 2,
                        fontSize: 10, color: isPast ? color + '88' : color,
                      }}>{dir === 'right' ? '▶' : '◀'}</div>
                      <div style={{ color: isPast ? '#334155' : isCurrent ? '#f1f5f9' : '#94a3b8', fontSize: 10, fontWeight: isCurrent ? 700 : 400, transition: 'color 0.2s' }}>
                        {ev.label}
                      </div>
                      {ev.frame && <div style={{ color: '#475569', fontSize: 9 }}>{ev.frame.bytes} bytes</div>}
                    </div>
                  ) : (
                    <div style={{ color: isPast ? '#334155' : isCurrent ? '#f1f5f9' : '#64748b', fontSize: 10, fontWeight: isCurrent ? 700 : 400, padding: '4px 0', transition: 'color 0.2s' }}>
                      ⟳ {ev.label}
                    </div>
                  )}
                </div>
                {/* Right actor column */}
                <div style={{ width: 70, paddingLeft: 6 }}>
                  {isFrame && ev.to === 'target' && dir === 'right' && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>HOST B</span>
                  )}
                  {isFrame && ev.from === 'target' && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>HOST B</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
