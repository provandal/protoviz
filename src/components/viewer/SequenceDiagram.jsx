import { useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PHASE_COLORS } from '../../utils/constants';
import useViewerStore from '../../store/viewerStore';
import useCommunityNotes from '../../hooks/useCommunityNotes';
import { isRtl } from '../../utils/rtl';

/**
 * Determine the visual span of a state_change event based on which actors it affects.
 * Returns: 'left' (left actor + switch only), 'right' (switch + right actor only),
 *          'full' (both endpoints or all three), 'center' (switch only)
 */
function getStateChangeSpan(ev, leftId, rightId) {
  if (!ev.state) return 'full';
  const actors = Object.keys(ev.state);
  const hasLeft = actors.includes(leftId);
  const hasRight = actors.includes(rightId);
  const hasOther = actors.some(a => a !== leftId && a !== rightId);

  if (hasLeft && !hasRight) return 'left';
  if (hasRight && !hasLeft) return 'right';
  if (hasOther && !hasLeft && !hasRight) return 'center';
  return 'full';
}

/**
 * Determine the visual span of a frame_tx event based on from/to.
 * Frames to/from the switch stop at the center column.
 */
function getFrameSpan(ev, leftId, rightId) {
  const { from, to } = ev;
  const isLeftEnd = id => id === leftId;
  const isRightEnd = id => id === rightId;
  if ((isLeftEnd(from) && !isRightEnd(to)) || (!isRightEnd(from) && isLeftEnd(to))) return 'left';
  if ((isRightEnd(from) && !isLeftEnd(to)) || (!isLeftEnd(from) && isRightEnd(to))) return 'right';
  return 'full';
}

export default function SequenceDiagram({ timeline, currentStep, onStepSelect, leftActorId = 'initiator', rightActorId = 'target' }) {
  const { t } = useTranslation();
  // Build phase groups as consecutive runs to preserve chronological order.
  // If the same phase reappears later, it gets its own group in the correct position.
  const phaseGroups = [];
  let currentPhase = null;
  for (const ev of timeline) {
    if (ev.phase !== currentPhase) {
      phaseGroups.push({ phase: ev.phase, events: [ev] });
      currentPhase = ev.phase;
    } else {
      phaseGroups[phaseGroups.length - 1].events.push(ev);
    }
  }
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

  // Community notes indicators
  const { stepsWithNotes: communitySteps } = useCommunityNotes(slug);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [currentStep]);

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {phaseGroups.map(({ phase, events }) => (
        <div key={phase} style={{ marginBottom: 8 }}>
          <div
            className="pvz-phase-header"
            style={{
              padding: '3px 10px', background: `${PHASE_COLORS[phase]}22`,
              borderLeft: `3px solid ${PHASE_COLORS[phase]}`,
              '--phase-color': PHASE_COLORS[phase],
              color: PHASE_COLORS[phase] || '#94a3b8', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >{phase}</div>
          {events.map(ev => {
            const idx = timeline.indexOf(ev);
            const isCurrent = idx === currentStep;
            const isPast = idx < currentStep;
            const hasNote = !!annotations[idx];
            const hasCommunityNote = communitySteps.has(idx);
            const color = ev.color || '#475569';
            const isFrame = ev.type === 'frame_tx';
            const span = isFrame ? getFrameSpan(ev, leftActorId, rightActorId) : getStateChangeSpan(ev, leftActorId, rightActorId);
            // Direction: who is sending?
            const goesRight = isFrame && (ev.from === leftActorId || (ev.from !== rightActorId && ev.to === rightActorId));
            const dir = isFrame ? (goesRight ? 'right' : 'left') : null;
            // Sender/receiver labels
            const senderLabel = actorLabels[ev.from] || ev.from?.toUpperCase();
            const receiverLabel = actorLabels[ev.to] || ev.to?.toUpperCase();

            return (
              <div
                key={ev.id}
                ref={isCurrent ? currentRef : undefined}
                onClick={() => onStepSelect(idx)}
                className="pvz-seq-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 0, padding: '5px 8px', cursor: 'pointer',
                  background: isCurrent ? `${color}18` : isPast ? '#0a0f1a' : 'transparent',
                  '--row-border-color': isCurrent ? color : 'transparent',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => !isCurrent && (e.currentTarget.style.background = '#0f172a')}
                onMouseLeave={e => !isCurrent && (e.currentTarget.style.background = isPast ? '#0a0f1a' : 'transparent')}
              >
                {/* Note indicators */}
                <div style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                  {hasNote && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} title={t('community.hasPersonalNote')} />
                  )}
                  {hasCommunityNote && (
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} title={t('community.hasCommunityNote')} />
                  )}
                </div>
                {/* Arrow area: scaleX(-1) in RTL so arrows mirror, with text un-mirrored */}
                <div className="pvz-seq-arrows" style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                  {/* Left actor column */}
                  <div style={{ width: 70, display: 'flex', justifyContent: 'flex-end', paddingRight: 6 }}>
                    {isFrame && goesRight && (
                      <span className="pvz-seq-label" style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{senderLabel}</span>
                    )}
                    {isFrame && !goesRight && (
                      <span className="pvz-seq-label" style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{'\u25C0'}</span>
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
                      <span className="pvz-seq-label" style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{receiverLabel}</span>
                    )}
                    {isFrame && !goesRight && (
                      <span className="pvz-seq-label" style={{ color: isPast ? color + '99' : color, fontSize: 9, fontWeight: 700 }}>{senderLabel}</span>
                    )}
                  </div>
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
 * 'left' = initiator<->switch, 'right' = switch<->target, 'full' = end-to-end
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
      }}>{dir === 'right' ? '\u25B6' : '\u25C0'}</div>
      <div className="pvz-seq-label" style={{ color: isPast ? '#334155' : isCurrent ? '#f1f5f9' : '#94a3b8', fontSize: 10, fontWeight: isCurrent ? 700 : 400, transition: 'color 0.2s' }}>
        {ev.label}
      </div>
      {ev.frame && ev.frame.bytes > 0 && <div className="pvz-seq-label" style={{ color: '#475569', fontSize: 9 }}>{ev.frame.bytes} bytes</div>}
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
        <div className="pvz-seq-label" style={{
          color: textColor, fontSize: 10,
          fontWeight: isCurrent ? 700 : 400,
          padding: '0 4px',
          transition: 'color 0.2s',
          textAlign: 'center',
        }}>
          {'\u27F3'} {ev.label}
        </div>
      </div>
    </div>
  );
}
