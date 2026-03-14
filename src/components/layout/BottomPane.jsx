import useViewerStore from '../../store/viewerStore';
import EventDetail from '../viewer/EventDetail';
import PacketInspector from '../viewer/PacketInspector';
import ChatPanel from '../chat/ChatPanel';
import AboutPanel from '../about/AboutPanel';

const TABS = [
  { id: 'explain', label: 'Explain' },
  { id: 'inspect', label: 'Inspect Packet' },
  { id: 'chat', label: 'Chat' },
  { id: 'about', label: 'About' },
];

export default function BottomPane({ event, phaseColor, onPopout }) {
  const activeTab = useViewerStore(s => s.activeBottomTab);
  const setActiveTab = useViewerStore(s => s.setActiveBottomTab);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f1a' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#0f172a', flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const isDisabled = tab.id === 'inspect' && !event?.frame;
          const hasFrame = tab.id === 'inspect' && event?.frame && !isActive;
          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && setActiveTab(tab.id)}
              disabled={isDisabled}
              style={{
                background: isActive ? '#0a0f1a' : 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                color: isActive ? '#e2e8f0' : isDisabled ? '#1e293b' : '#64748b',
                padding: '8px 16px',
                fontSize: 11, fontWeight: 600,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                transition: 'color 0.15s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {tab.label}
              {hasFrame && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
              )}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {onPopout && (
          <button
            onClick={onPopout}
            title="Pop out to separate window"
            style={{
              background: 'none', border: '1px solid #334155', color: '#64748b',
              padding: '3px 8px', marginRight: 8, borderRadius: 3,
              cursor: 'pointer', fontSize: 13, lineHeight: 1,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          >
            ⧉
          </button>
        )}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'explain' && <EventDetail event={event} phaseColor={phaseColor} />}
        {activeTab === 'inspect' && <PacketInspector event={event} />}
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'about' && <AboutPanel />}
      </div>
    </div>
  );
}
