import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useViewerStore from '../../store/viewerStore';
import useScenario from '../../hooks/useScenario';
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#020817', color: '#64748b', fontFamily: "'IBM Plex Sans',system-ui,sans-serif" }}>
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
  const initLayers = buildStateAtStep(scenario, 'initiator', step);
  const targLayers = buildStateAtStep(scenario, 'target', step);
  const swLayers = buildStateAtStep(scenario, 'switch', step);
  const phaseColor = PHASE_COLORS[ev.phase] || '#475569';

  const topContent = (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Host A OSI Stack */}
      <div style={{ width: 220, borderRight: '1px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <OsiStack actorId="initiator" label="Host A — Initiator" layers={initLayers} stepEvent={ev} />
      </div>

      {/* Center: Sequence + Controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ActorHeaders actors={scenario.actors} />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#020817' }}>
          <SequenceDiagram timeline={scenario.timeline} currentStep={step} onStepSelect={goToStep} />
        </div>
        <PlaybackControls total={total} phaseColor={phaseColor} />
      </div>

      {/* Host B OSI Stack */}
      <div style={{ width: 220, borderLeft: '1px solid #1e293b', overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <OsiStack actorId="target" label="Host B — Target" layers={targLayers} stepEvent={ev} />
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
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif", overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
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
