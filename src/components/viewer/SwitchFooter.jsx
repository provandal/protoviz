import { L_COLOR } from '../../utils/constants';

export default function SwitchFooter({ layers }) {
  const sorted = [...layers].sort((a, b) => a.layer - b.layer);

  return (
    <div style={{
      padding: '4px 12px', background: '#050d1a', borderTop: '1px solid #1e293b',
      display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0,
      overflowX: 'auto',
    }}>
      <span style={{ color: '#334155', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>SWITCH</span>
      {sorted.map(l => {
        const color = L_COLOR[l.layer] || '#475569';
        return (
          <div key={l.layer} style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <span style={{ color, fontSize: 8, fontWeight: 700, opacity: 0.7 }}>L{l.layer}</span>
            {Object.entries(l.fields).map(([k, v]) => (
              <span key={k} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                <span style={{ color: '#334155', fontSize: 8, fontFamily: 'monospace' }}>{k}</span>
                <span style={{
                  color: String(v).includes('UP') || String(v).includes('up') || String(v).includes('COMPLETE') || v === true ? '#34d399' :
                         String(v).includes('down') || String(v).includes('idle') || v === false || v === 0 ? '#475569' :
                         '#fbbf24',
                  fontSize: 8, fontFamily: 'monospace', fontWeight: 600,
                }}>{String(v)}</span>
              </span>
            ))}
            <span style={{ color: '#1e293b', fontSize: 8 }}>|</span>
          </div>
        );
      })}
    </div>
  );
}
