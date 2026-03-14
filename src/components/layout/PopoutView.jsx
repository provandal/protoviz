import { usePopoutReceiver } from '../../hooks/usePopout';
import useViewerStore from '../../store/viewerStore';
import { PHASE_COLORS } from '../../utils/constants';
import BottomPane from './BottomPane';

export default function PopoutView() {
  usePopoutReceiver();

  const scenario = useViewerStore(s => s.scenario);
  const step = useViewerStore(s => s.step);

  if (!scenario) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0a0f1a', color: '#64748b',
        fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
      }}>
        Connecting to main window...
      </div>
    );
  }

  const ev = scenario.timeline[step];
  const phaseColor = PHASE_COLORS[ev?.phase] || '#475569';

  return (
    <div style={{
      height: '100vh', background: '#0a0f1a', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Mini header */}
      <div style={{
        padding: '6px 12px', background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <div style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', borderRadius: 4, padding: '2px 6px' }}>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{
          background: `${phaseColor}22`, color: phaseColor,
          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
          border: `1px solid ${phaseColor}44`,
        }}>
          {ev?.phase}
        </span>
        <span style={{ color: '#94a3b8', fontSize: 10 }}>
          Step {step + 1}/{scenario.timeline.length}
        </span>
        <span style={{ color: '#64748b', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          — {ev?.label}
        </span>
      </div>

      {/* Bottom pane fills the rest */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <BottomPane event={ev} phaseColor={phaseColor} />
      </div>
    </div>
  );
}
