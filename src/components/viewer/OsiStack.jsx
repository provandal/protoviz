import { L_COLOR } from '../../utils/constants';
import { isRtl, endAlign } from '../../utils/rtl';

export default function OsiStack({ actorId, label, layers, stepEvent }) {
  const activeLayers = new Set();
  if (stepEvent) {
    if (stepEvent.type === 'frame_tx') {
      if (stepEvent.frame) {
        stepEvent.frame.headers.forEach(h => activeLayers.add(h.layer));
      }
    }
    if (stepEvent.state && stepEvent.state[actorId]) {
      Object.keys(stepEvent.state[actorId]).forEach(l => activeLayers.add(parseInt(l)));
    }
  }

  const sorted = [...layers].sort((a, b) => b.layer - a.layer);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 10px', background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
        <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 700 }}>{label}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {sorted.map(layer => {
          const isActive = activeLayers.has(layer.layer);
          const color = L_COLOR[layer.layer] || '#475569';
          return (
            <div key={layer.layer} style={{
              marginBottom: 4, borderRadius: 5,
              border: `1px solid ${isActive ? color : color + '33'}`,
              background: isActive ? `${color}18` : '#0a0f1a',
              transition: 'all 0.3s',
              boxShadow: isActive ? `0 0 8px ${color}44` : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: `1px solid ${color}22` }}>
                <span style={{ background: isActive ? color : `${color}44`, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, transition: 'background 0.3s' }}>L{layer.layer}</span>
                <span style={{ color: isActive ? '#f1f5f9' : '#64748b', fontSize: 10, fontWeight: 600, transition: 'color 0.3s' }}>{layer.name}</span>
                {isActive && <span style={{ marginInlineStart: 'auto', width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}` }} />}
              </div>
              <div style={{ padding: '4px 8px 6px' }}>
                {Object.entries(layer.fields).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '1px 0' }}>
                    <span style={{ color: '#475569', fontSize: 9, fontFamily: 'monospace' }}>{k}</span>
                    <span title={String(v)} style={{
                      color: String(v).includes('RTS') || String(v).includes('UP') || String(v).includes('ESTABLISHED') || String(v).includes('complete') ? '#34d399' :
                             String(v).includes('down') || String(v).includes('RESET') || String(v).includes('idle') || v === false ? '#475569' :
                             '#fbbf24',
                      fontSize: 9, fontFamily: 'monospace', fontWeight: 600, maxWidth: 200, textAlign: endAlign(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
