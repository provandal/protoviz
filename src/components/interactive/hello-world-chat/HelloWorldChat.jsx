import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useChatStore from '../../../store/chatStore';
import useDirection from '../../../hooks/useDirection';
import TopologySelector from './TopologySelector';
import LiveChatPanel from './LiveChatPanel';
import AnimatedProtocolPanel from './AnimatedProtocolPanel';
import FieldInspector from './FieldInspector';

export default function HelloWorldChat() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  useDirection();
  const mode = useChatStore(s => s.mode);
  const roomCode = useChatStore(s => s.roomCode);
  const selectedField = useChatStore(s => s.selectedField);

  // Update URL with room code and mode when they change
  useEffect(() => {
    if (mode && roomCode) {
      const newParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
      newParams.set('room', roomCode);
      newParams.set('mode', mode.toString());
      const basePath = window.location.hash.split('?')[0];
      window.history.replaceState(null, '', `${window.location.pathname}${basePath}?${newParams.toString()}`);
    }
  }, [mode, roomCode]);

  if (mode === null) {
    // Pass URL params to TopologySelector for auto-fill
    const urlRoom = searchParams.get('room') || '';
    const urlMode = parseInt(searchParams.get('mode'), 10) || null;
    return <TopologySelector initialRoom={urlRoom} initialMode={urlMode} />;
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 16px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', display: 'flex', alignItems: 'center',
        gap: 12, flexShrink: 0,
      }}>
        <button
          onClick={() => { useChatStore.getState().reset(); navigate('/'); }}
          style={{
            background: 'none', border: 'none', color: '#64748b',
            cursor: 'pointer', fontSize: 14, padding: '4px 8px',
          }}
        >
          ← {t('common.back')}
        </button>
        <div style={{
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          borderRadius: 6, padding: '3px 10px', display: 'inline-block',
        }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          {t('helloChat.title', 'Hello World Chat')}
        </span>
        <span style={{
          background: '#052e16', color: '#4ade80', border: '1px solid #16a34a44',
          fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
          animation: 'pvz-live-pulse 2s ease-in-out infinite',
        }}>
          LIVE
        </span>
      </div>

      {/* Main 3-panel layout */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left: Chat panel */}
        <div style={{
          width: '30%', minWidth: 280, maxWidth: 400,
          borderInlineEnd: '1px solid #1e293b',
          display: 'flex', flexDirection: 'column',
        }}>
          <LiveChatPanel />
        </div>

        {/* Center: Protocol panel */}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <AnimatedProtocolPanel />
        </div>

        {/* Right: Field inspector (shown when a field is selected) */}
        {selectedField && (
          <div style={{
            width: '30%', minWidth: 280, maxWidth: 400,
            borderInlineStart: '1px solid #1e293b',
            overflow: 'auto',
          }}>
            <FieldInspector />
          </div>
        )}
      </div>
    </div>
  );
}
