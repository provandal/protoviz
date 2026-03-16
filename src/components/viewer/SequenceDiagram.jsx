import { useRef, useEffect, useMemo } from 'react';
import { PHASE_COLORS } from '../../utils/constants';
import useViewerStore from '../../store/viewerStore';

/**
 * Determine the visual span of a state_change event based on which actors it affects.
 * Returns: 'left' (initiator + switch only), 'right' (switch + target only),
 *          'full' (both endpoints or all three), 'center' (switch only)
 */
function getStateChangeSpan(ev) {
  if (!ev.state) return 'full';
  const actors = Object.keys(ev.state);
  const hasInit = actors.includes('initiator');
  const hasTarget = actors.includes('target');
  const hasSwitch = actors.includes('switch');

  if (hasInit && !hasTarget) return 'left';
  if (hasTarget && !hasInit) return 'right';
  if (hasSwitch && !hasInit && !hasTarget) return 'center';
  return 'full';
}

/**
 * Determine the visual span of a frame_tx event based on from/to.
 * Frames to/from the switch stop at the center column.
 */
function getFrameSpan(ev) {
  const { from, to } = ev;
  if ((from === 'initiator' && to === 'switch') || (from === 'switch' && to === 'initiator')) return 'left';
  if ((from === 'target' && to === 'switch') || (from === 'switch' && to === 'target')) return 'right';
  return 'full';
}

export default function SequenceDiagram({ timeline, currentStep, onStepSelect }) {
  const phases = [...new Set(timeline.map(e => e.phase))];
  const phaseGroups = phases.map(p => ({ phase: p, events: timeline.filter(e => e.phase === p) }));
  const currentRef = useRef(null);
  const slug = useViewerStore(s => s.currentSlug);
  const scenario = useViewerStore(s => s.scenario);

  // Build actor label lookup from scenario
  const actorLabels = useMemo(() => {
    if (!scenario?.actors) return {};
    const labels = {};
    for (const a of scenario.actors) {
      // Use short label: first word or text before '('
      const short = a.label.includes('(')
        ? a.label.match(/\(([^)]+)\)/)?.[1] || a.label.split(/\s/)[0]
        : a.label.split(/\s/)[0];
      labels[a.id] = short.toUpperCase();
    }
    return labels;
  }, [scenario]);

  // Read annotations from localStorage for note indicators
  const annotations = useMemo(() => {
    if (!slug) return {};
    try {
      const stored = localStorage.getItem(`protoviz_annotations_${slug}`);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }, [slug, currentStep]);

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
            const span = isFrame ? getFrameSpan(ev) : getStateChangeSpan(ev);
            // Direction: who is sending?
            const goesRight = isFrame && (ev.from === 'initiator' || (ev.from === 'switch' && ev.to === 'target'));
            const dir = isFrame ? (goesRight ? 'right' : 'left') : null;
            // Sender/receiver labels
            const senderLabel = actorLabels[ev.from] || ev.from?.toUpperCase();
            const receiverLabel = actorLabels[ev.to] || ev.to?.toUpperCase();

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
                  {isFrame && goesRight && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{senderLabel}</span>
                  )}
                  {isFrame && !goesRight && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>◀</span>
                  )}
                </div>
                {/* Arrow / label */}
                <div style={{ flex: 1, textAlign: 'center', position: 'relative' }}>
                  {isFrame ? (
                    <FrameRow ev={ev} dir={dir} span={span} color={color} isCurrent={isCurrent} isPast={isPast} receiverLabel={receiverLabel} />
                  ) : (
                    <StateChangeRow ev={ev} span={span} isCurrent={isCurrent} isPast={isPast} />
                  )}
                </div>
                {/* Right actor column */}
                <div style={{ width: 70, paddingLeft: 6 }}>
                  {isFrame && goesRight && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{receiverLabel}</span>
                  )}
                  {isFrame && !goesRight && (
                    <span style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{senderLabel}</span>
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

/**
 * Renders a frame_tx event with arrow span based on from/to actors.
 * 'left' = initiator↔switch, 'right' = switch↔target, 'full' = end-to-end
 */
function FrameRow({ ev, dir, span, color, isCurrent, isPast, receiverLabel }) {
  const alignment = span === 'left' ? 'flex-start' : span === 'right' ? 'flex-end' : 'stretch';
  const widthPct = (span === 'left' || span === 'right') ? '55%' : '100%';

  const content = (
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
  );

  if (span === 'full') return content;

  return (
    <div style={{ display: 'flex', justifyContent: alignment, width: '100%' }}>
      <div style={{ width: widthPct }}>{content}</div>
    </div>
  );
}

/**
 * Renders a state_change event with visual span indicating which actors are involved.
 */
function StateChangeRow({ ev, span, isCurrent, isPast }) {
  const textColor = isPast ? '#334155' : isCurrent ? '#f1f5f9' : '#64748b';
  const lineColor = isPast ? '#334155' : isCurrent ? '#475569' : '#1e293b';

  const alignment = span === 'left' ? 'flex-start' : span === 'right' ? 'flex-end' : 'center';
  const widthPct = (span === 'left' || span === 'right') ? '55%' : span === 'center' ? '30%' : '100%';

  return (
    <div style={{ display: 'flex', justifyContent: alignment, width: '100%' }}>
      <div style={{ width: widthPct, position: 'relative' }}>
        <div style={{
          height: 1, borderTop: `1px dashed ${lineColor}`,
          margin: '8px 0',
          transition: 'all 0.3s',
        }} />
        <div style={{
          color: textColor, fontSize: 10,
          fontWeight: isCurrent ? 700 : 400,
          padding: '0 4px',
          transition: 'color 0.2s',
          textAlign: 'center',
        }}>
          ⟳ {ev.label}
        </div>
      </div>
    </div>
  );
}
