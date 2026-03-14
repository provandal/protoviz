export default function SwitchFooter({ layers }) {
  return (
    <div style={{
      padding: '4px 12px', background: '#050d1a', borderTop: '1px solid #1e293b',
      display: 'flex', gap: 16, alignItems: 'center', flexShrink: 0,
    }}>
      <span style={{ color: '#334155', fontSize: 9, fontWeight: 700 }}>SWITCH</span>
      {layers.map(l =>
        Object.entries(l.fields).map(([k, v]) => (
          <span key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: '#334155', fontSize: 9, fontFamily: 'monospace' }}>{k}</span>
            <span style={{ color: String(v).includes('up') || v === true ? '#34d399' : '#475569', fontSize: 9, fontFamily: 'monospace', fontWeight: 600 }}>{String(v)}</span>
          </span>
        ))
      )}
    </div>
  );
}
