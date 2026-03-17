import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useViewerStore from '../../store/viewerStore';
import useScenario from '../../hooks/useScenario';
import useMediaQuery from '../../hooks/useMediaQuery';
import { buildStateAtStep } from '../../utils/stateEngine';
import { PHASE_COLORS } from '../../utils/constants';
import usePlayback from '../../hooks/usePlayback';
import useKeyboardNav from '../../hooks/useKeyboardNav';
import { usePopout } from '../../hooks/usePopout';
import OsiStack from './OsiStack';
import SequenceDiagram from './SequenceDiagram';
import ActorHeaders from './ActorHeaders';
import PlaybackControls from './PlaybackControls';
import SwitchFooter from './SwitchFooter';
import SplitLayout from '../layout/SplitLayout';
import BottomPane from '../layout/BottomPane';

const DEFAULT_SCENARIO = 'roce-v2-rc-connection-rdma-write-read';

/* ── Mobile top-panel tabs ─────────────────────────────────────── */
function getMobileTabs(leftLabel, rightLabel) {
  return [
    { id: 'sequence', label: 'Sequence' },
    { id: 'left', label: leftLabel || 'Initiator' },
    { id: 'right', label: rightLabel || 'Target' },
  ];
}

function MobileTopTabs({ tabs, active, onChange }) {
  return (
    <div className="pvz-mobile-top-tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`pvz-mobile-top-tab${active === tab.id ? ' pvz-mobile-top-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function ProtoVizViewer() {
  const { scenarioSlug, stepNum } = useParams();
  const navigate = useNavigate();
  const slug = scenarioSlug || DEFAULT_SCENARIO;

  useScenario(slug);
  usePlayback();
  useKeyboardNav();
  const { handlePopout, focusPopout } = usePopout();

  const scenario = useViewerStore(s => s.scenario);
  const loading = useViewerStore(s => s.loading);
  const error = useViewerStore(s => s.error);
  const step = useViewerStore(s => s.step);
  const splitPosition = useViewerStore(s => s.splitPosition);
  const poppedOut = useViewerStore(s => s.poppedOut);
  const goToStep = useViewerStore(s => s.goToStep);

  // Responsive breakpoints
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1024px)');

  // Mobile: which top panel is active
  const [mobileTopTab, setMobileTopTab] = useState('sequence');

  // Deep link: set step from URL on mount
  useEffect(() => {
    if (stepNum && scenario) {
      const idx = parseInt(stepNum, 10) - 1; // URL is 1-indexed
      if (idx >= 0 && idx < scenario.timeline.length) {
        goToStep(idx);
      }
    }
  }, [stepNum, scenario, goToStep]);

  // Deep link: update URL when step changes
  useEffect(() => {
    if (scenario && slug) {
      navigate(`/${slug}/step/${step + 1}`, { replace: true });
    }
  }, [step, slug, scenario, navigate]);

  if (loading || !scenario) {
    return (
      <div className="pvz-loading">
        {error ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#ef4444', fontSize: 14, marginBottom: 8 }}>Failed to load scenario</div>
            <div style={{ color: '#475569', fontSize: 12 }}>{error}</div>
          </div>
        ) : (
          'Loading scenario...'
        )}
      </div>
    );
  }

  const total = scenario.timeline.length;
  const ev = scenario.timeline[step];

  // Derive left/right/switch actors from topology positions (not hardcoded IDs)
  const leftActor = scenario.actors.find(a => a.pos === 'left') || scenario.actors[0];
  const rightActor = scenario.actors.find(a => a.pos === 'right') || scenario.actors[scenario.actors.length - 1];
  const switchActor = scenario.actors.find(a => a.pos === 'center' || a.type === 'switch');
  const leftId = leftActor.id;
  const rightId = rightActor.id;
  const switchId = switchActor?.id || 'switch';

  const initLayers = buildStateAtStep(scenario, leftId, step);
  const targLayers = buildStateAtStep(scenario, rightId, step);
  const swLayers = buildStateAtStep(scenario, switchId, step);
  const phaseColor = PHASE_COLORS[ev.phase] || '#475569';

  const initLabel = leftActor?.label || 'Initiator';
  const targLabel = rightActor?.label || 'Target';

  // OSI width based on breakpoint
  const osiWidth = isTablet ? 170 : 220;

  /* ── MOBILE layout (<768px) ──────────────────────────────────── */
  if (isMobile) {
    const topContent = (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <MobileTopTabs tabs={getMobileTabs(initLabel, targLabel)} active={mobileTopTab} onChange={setMobileTopTab} />

        {/* Sequence tab */}
        <div style={{ flex: 1, display: mobileTopTab === 'sequence' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <ActorHeaders actors={scenario.actors} />
          <div className="pvz-seq-scroll-wrapper">
            <SequenceDiagram timeline={scenario.timeline} currentStep={step} onStepSelect={goToStep} leftActorId={leftId} rightActorId={rightId} />
          </div>
        </div>

        {/* Left actor OSI tab */}
        <div style={{ flex: 1, display: mobileTopTab === 'left' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <OsiStack actorId={leftId} label={initLabel} layers={initLayers} stepEvent={ev} />
        </div>

        {/* Right actor OSI tab */}
        <div style={{ flex: 1, display: mobileTopTab === 'right' ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
          <OsiStack actorId={rightId} label={targLabel} layers={targLayers} stepEvent={ev} />
        </div>

        {/* Playback controls: always visible on mobile */}
        <PlaybackControls total={total} phaseColor={phaseColor} />
      </div>
    );

    const bottomContent = poppedOut ? (
      <div
        onClick={focusPopout}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', background: '#0a0f1a', cursor: 'pointer',
          color: '#475569', fontSize: 12,
          border: '1px dashed #1e293b', borderRadius: 4, margin: 4,
        }}
      >
        Detail panel is in a separate window
      </div>
    ) : (
      <BottomPane event={ev} phaseColor={phaseColor} onPopout={handlePopout} />
    );

    return (
      <div className="pvz-root">
        {/* Compact mobile header */}
        <div className="pvz-header pvz-header--mobile">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              onClick={() => navigate('/')}
              style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
            >
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em' }}>PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span></span>
            </div>
            <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{scenario.meta.title}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ background: `${phaseColor}22`, color: phaseColor, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: `1px solid ${phaseColor}44` }}>
              {ev.phase}
            </span>
            <span style={{ color: '#475569', fontSize: 9 }}>{step + 1}/{total}</span>
          </div>
        </div>

        <SplitLayout
          top={topContent}
          bottom={bottomContent}
          splitPercent={splitPosition}
          onSplitChange={(pos) => useViewerStore.getState().setSplitPosition(pos)}
        />

        <SwitchFooter layers={swLayers} />
      </div>
    );
  }

  /* ── DESKTOP & TABLET layout (>=768px) ───────────────────────── */
  const topContent = (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left OSI Stack */}
      <div className="pvz-osi-col" style={{ width: osiWidth }}>
        <OsiStack actorId={leftId} label={initLabel} layers={initLayers} stepEvent={ev} />
      </div>

      {/* Center: Sequence + Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ActorHeaders actors={scenario.actors} />
        <div className="pvz-seq-scroll-wrapper">
          <SequenceDiagram timeline={scenario.timeline} currentStep={step} onStepSelect={goToStep} leftActorId={leftId} rightActorId={rightId} />
        </div>
        <PlaybackControls total={total} phaseColor={phaseColor} />
      </div>

      {/* Right OSI Stack */}
      <div className="pvz-osi-col pvz-osi-col--right" style={{ width: osiWidth }}>
        <OsiStack actorId={rightId} label={targLabel} layers={targLayers} stepEvent={ev} />
      </div>
    </div>
  );

  const bottomContent = poppedOut ? (
    <div
      onClick={focusPopout}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: '#0a0f1a', cursor: 'pointer',
        color: '#475569', fontSize: 12,
        border: '1px dashed #1e293b', borderRadius: 4, margin: 4,
      }}
    >
      Detail panel is in a separate window — click to focus
    </div>
  ) : (
    <BottomPane event={ev} phaseColor={phaseColor} onPopout={handlePopout} />
  );

  return (
    <div className="pvz-root">
      {/* Header */}
      <div className="pvz-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            onClick={() => navigate('/')}
            style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
          >
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span></span>
          </div>
          <span style={{ color: '#334155', fontSize: 12 }}>|</span>
          <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>{scenario.meta.title}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: `${phaseColor}22`, color: phaseColor, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: `1px solid ${phaseColor}44` }}>
            {ev.phase}
          </span>
          <span style={{ color: '#475569', fontSize: 10 }}>Step {step + 1}/{total}</span>
        </div>
      </div>

      {/* Split layout: top = visualization, bottom = detail tabs */}
      <SplitLayout
        top={topContent}
        bottom={bottomContent}
        splitPercent={splitPosition}
        onSplitChange={(pos) => useViewerStore.getState().setSplitPosition(pos)}
      />

      {/* Switch state footer strip */}
      <SwitchFooter layers={swLayers} />
    </div>
  );
}
