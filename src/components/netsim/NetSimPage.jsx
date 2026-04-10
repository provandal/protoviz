import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import NetSimTopology from './NetSimTopology';
import NetSimControls from './NetSimControls';
import LinkTooltip from './LinkTooltip';
import LanguageSelector from '../common/LanguageSelector';
import useReplay from './hooks/useReplay';

export default function NetSimPage() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const topologyUrl = useMemo(() => {
    const base = import.meta.env.BASE_URL;
    return `${base}netsim/${scenarioId}/topology.json`;
  }, [scenarioId]);

  const {
    topology, loading, error,
    currentFrame, playheadMs, durationMs,
    isPlaying, speed,
    play, pause, seek, setSpeed,
    activeVariant, setVariant,
  } = useReplay(topologyUrl);

  const [hoveredLink, setHoveredLink] = useState(null);
  const [hoveredLinkState, setHoveredLinkState] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function onMouseMove(e) { setMousePos({ x: e.clientX, y: e.clientY }); }
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  // Find the active narrative event for the current playhead
  const activeNarrative = useMemo(() => {
    if (!topology?.narrative_events) return null;
    const sorted = [...topology.narrative_events].sort((a, b) => a.t_ms - b.t_ms);
    let active = null;
    for (const ev of sorted) {
      if (ev.t_ms <= playheadMs) active = ev;
      else break;
    }
    return active;
  }, [topology, playheadMs]);

  function handleLinkClick(link) {
    if (link.packet_scenario) {
      navigate(`/${link.packet_scenario}`);
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div
          onClick={() => navigate('/')}
          style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
        >
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#334155', fontSize: 12 }}>|</span>
        <span style={{
          background: '#0f172a', color: '#f97316',
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
          border: '1px solid #f9731644',
        }}>
          {t('netsim.fabricBadge')}
        </span>
        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, flex: 1 }}>
          {topology?.title || t('netsim.loading')}
        </span>
        <LanguageSelector />
      </div>

      {/* Body */}
      {loading && !topology ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
          {t('netsim.loading')}
        </div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
          {error}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Description bar */}
          {topology?.description && (
            <div style={{
              padding: '10px 16px', background: '#0a0f1a',
              borderBottom: '1px solid #1e293b',
              color: '#94a3b8', fontSize: 12, lineHeight: 1.5,
            }}>
              {topology.description}
            </div>
          )}

          {/* Topology canvas */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <NetSimTopology
              topology={topology}
              currentFrame={currentFrame}
              onLinkHover={(link, state) => {
                setHoveredLink(link);
                setHoveredLinkState(state);
              }}
              onLinkClick={handleLinkClick}
              hoveredLinkId={hoveredLink?.id}
            />

            {/* Legend */}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: 'rgba(15,23,42,0.92)', border: '1px solid #1e293b',
              borderRadius: 6, padding: '8px 10px',
              fontSize: 10, color: '#94a3b8',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: 9 }}>
                {t('netsim.linkUtilization')}
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div style={{
                  width: 120, height: 8, borderRadius: 2,
                  background: 'linear-gradient(90deg, rgb(59,130,246), rgb(250,204,21), rgb(239,68,68))',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: 120, marginTop: 2, fontSize: 9 }}>
                <span>0%</span><span>50%</span><span>100%</span>
              </div>
            </div>

            {/* Narrative event overlay */}
            {activeNarrative && (
              <div style={{
                position: 'absolute', bottom: 12, left: 12, right: 12,
                background: 'rgba(15,23,42,0.95)', border: '1px solid #1e293b',
                borderLeft: '3px solid #8b5cf6',
                borderRadius: 6, padding: '8px 14px',
                color: '#e2e8f0', fontSize: 12, lineHeight: 1.5,
                pointerEvents: 'none',
              }}>
                <span style={{ color: '#a78bfa', fontWeight: 700, marginInlineEnd: 8 }}>
                  t={Math.round(activeNarrative.t_ms / 100) / 10}s
                </span>
                {activeNarrative.text}
              </div>
            )}

            {/* Hovered link tooltip */}
            {hoveredLink && (
              <LinkTooltip link={hoveredLink} state={hoveredLinkState} mousePos={mousePos} t={t} />
            )}
          </div>

          {/* Controls */}
          <div style={{ padding: '10px 16px', flexShrink: 0 }}>
            <NetSimControls
              topology={topology}
              playheadMs={playheadMs}
              durationMs={durationMs}
              isPlaying={isPlaying}
              speed={speed}
              onPlay={play}
              onPause={pause}
              onSeek={seek}
              onSetSpeed={setSpeed}
              activeVariant={activeVariant}
              onSetVariant={setVariant}
            />
          </div>
        </div>
      )}
    </div>
  );
}
