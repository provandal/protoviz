import { useState } from 'react';

export default function PacketField({ field, depth = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  const hasSpec = field.spec && field.spec.length > 0;
  const hasKernel = !!field.kernel;

  return (
    <div style={{ marginLeft: depth * 12, borderLeft: depth > 0 ? '2px solid #334155' : 'none', paddingLeft: depth > 0 ? 8 : 0 }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'grid', gridTemplateColumns: '22px 160px 1fr 120px', alignItems: 'start', padding: '5px 8px', cursor: 'pointer',
          background: expanded ? '#1e293b' : 'transparent',
          borderRadius: 4, userSelect: 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
        onMouseLeave={e => e.currentTarget.style.background = expanded ? '#1e293b' : 'transparent'}
      >
        <span style={{ color: '#64748b', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, marginTop: 1 }}>{field.bits}b</span>
        <span style={{ color: '#94a3b8', fontFamily: "'JetBrains Mono',monospace", fontSize: 10, marginTop: 1 }}>{field.abbrev}</span>
        <span style={{ color: '#e2e8f0', fontSize: 12 }}>{field.name}</span>
        <span style={{ color: '#f59e0b', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, textAlign: 'right', marginTop: 1 }}>{String(field.value)}</span>
      </div>
      {expanded && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, margin: '2px 0 4px 22px', padding: 10 }}>
          <p style={{ color: '#cbd5e1', fontSize: 12, margin: '0 0 8px', lineHeight: 1.5 }}>{field.desc}</p>
          {hasSpec && (
            <div>
              <button onClick={() => setShowSpec(s => !s)} style={{ background: 'none', border: '1px solid #334155', color: '#60a5fa', fontSize: 10, borderRadius: 4, padding: '2px 8px', cursor: 'pointer', marginBottom: 4 }}>
                {showSpec ? '▼' : '▶'} Spec References ({field.spec.length})
              </button>
              {showSpec && field.spec.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                  <span style={{ background: '#1e3a5f', color: '#93c5fd', fontSize: 10, padding: '1px 6px', borderRadius: 3, fontFamily: 'monospace' }}>{s.doc}</span>
                  <span style={{ color: '#64748b', fontSize: 10 }}>§{s.sec}</span>
                  {s.url && <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#34d399', fontSize: 10, textDecoration: 'none' }}>↗ Spec</a>}
                </div>
              ))}
            </div>
          )}
          {hasKernel && (
            <div style={{ marginTop: 6, padding: '6px 8px', background: '#0a0f1a', borderRadius: 4, borderLeft: '3px solid #f59e0b' }}>
              <div style={{ color: '#f59e0b', fontSize: 10, fontWeight: 700, marginBottom: 2 }}>🐧 Linux Kernel</div>
              <div style={{ color: '#94a3b8', fontSize: 10, fontFamily: 'monospace' }}>{field.kernel.file}</div>
              <div style={{ color: '#fbbf24', fontSize: 10, fontFamily: 'monospace' }}>{field.kernel.fn}()</div>
              {field.kernel.note && <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>{field.kernel.note}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
