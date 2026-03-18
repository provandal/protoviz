import HeaderBlock from './HeaderBlock';
import useViewerStore from '../../store/viewerStore';

export default function PacketInspector({ event }) {
  const highlightFields = useViewerStore(s => s.highlightFields);
  if (!event?.frame) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#334155', fontSize: 12,
        fontStyle: 'italic',
      }}>
        No packet data for this step
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header bar */}
      <div style={{
        padding: '6px 12px', background: '#0f172a', borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ color: '#3b82f6', fontSize: 11, fontWeight: 800 }}>PACKET INSPECTOR</span>
        <span style={{ color: '#475569', fontSize: 11 }}>—</span>
        <span style={{ color: '#e2e8f0', fontSize: 11 }}>{event.frame.name}</span>
        <span style={{ background: '#1e293b', color: '#94a3b8', fontSize: 9, padding: '1px 6px', borderRadius: 3 }}>{event.frame.bytes} bytes total</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: '#475569', fontSize: 9 }}>Click any field to expand</span>
      </div>

      {/* Header blocks */}
      <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
        {event.frame.headers.map((h, i) => <HeaderBlock key={i} hdr={h} highlightFields={highlightFields} />)}
      </div>
    </div>
  );
}
