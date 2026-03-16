import { useState, useRef, useEffect } from 'react';

function formatTimestamp(pkt, baseTimestamp) {
  const relative = pkt.timestamp - baseTimestamp;
  const secs = Math.floor(relative);
  const frac = relative - secs;
  const usec = Math.round(frac * 1e6);
  return `${secs}.${String(usec).padStart(6, '0')}`;
}

export default function PacketList({ packets, findings, selectedIndex, onPacketSelect }) {
  const [expanded, setExpanded] = useState(null);
  const selectedRef = useRef(null);
  const baseTimestamp = packets.length > 0 ? packets[0].timestamp : 0;

  // Build finding lookup by packet index
  const findingsByPkt = {};
  if (findings) {
    for (const f of findings) {
      if (!findingsByPkt[f.packetIndex]) findingsByPkt[f.packetIndex] = [];
      findingsByPkt[f.packetIndex].push(f);
    }
  }

  // Auto-scroll to selected packet when it changes
  useEffect(() => {
    if (selectedIndex != null && selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setExpanded(selectedIndex);
    }
  }, [selectedIndex]);

  return (
    <div>
      {/* Column headers */}
      <div style={{
        display: 'flex', padding: '6px 12px',
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 1,
        fontSize: 9, fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <span style={{ width: 50 }}>#</span>
        <span style={{ width: 110 }}>Time</span>
        <span style={{ flex: 1 }}>Summary</span>
        <span style={{ width: 60, textAlign: 'right' }}>Length</span>
      </div>

      {packets.map((pkt, i) => {
        const hasFinding = !!findingsByPkt[i];
        const isExpanded = expanded === i;
        const isSelected = selectedIndex === i;
        const hasRoce = pkt.layers.some(l => l.name.includes('BTH'));
        const hasTcpRst = pkt.layers.some(l => l.name === 'TCP' && l.fields.flag_names?.includes('RST'));

        return (
          <div key={i} ref={isSelected ? selectedRef : undefined}>
            <div
              onClick={() => {
                setExpanded(isExpanded ? null : i);
                onPacketSelect?.(i);
              }}
              style={{
                display: 'flex', padding: '4px 12px',
                cursor: 'pointer',
                background: isSelected ? '#172554' : hasFinding ? '#1c0a0a' : (i % 2 === 0 ? '#020817' : '#0a0f1a'),
                borderLeft: isSelected ? '3px solid #3b82f6' : hasFinding ? '3px solid #dc2626' : '3px solid transparent',
                fontSize: 11,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = isSelected ? '#172554' : hasFinding ? '#1c0a0a' : (i % 2 === 0 ? '#020817' : '#0a0f1a')}
            >
              <span style={{ width: 50, color: '#475569' }}>{i + 1}</span>
              <span style={{ width: 110, color: '#64748b', fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
                {formatTimestamp(pkt, baseTimestamp)}
              </span>
              <span style={{
                flex: 1, color: hasTcpRst ? '#f87171' : hasRoce ? '#60a5fa' : '#94a3b8',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontWeight: hasTcpRst ? 700 : 400,
              }}>
                {pkt.summary}
              </span>
              <span style={{ width: 60, textAlign: 'right', color: '#475569' }}>
                {pkt.capturedLen}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{
                padding: '8px 12px 8px 24px',
                background: '#0f172a', borderBottom: '1px solid #1e293b',
              }}>
                {pkt.layers.map((layer, li) => (
                  <div key={li} style={{ marginBottom: 8 }}>
                    <div style={{
                      color: '#60a5fa', fontSize: 10, fontWeight: 700, marginBottom: 4,
                    }}>
                      L{layer.layer} — {layer.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
                      {Object.entries(layer.fields).map(([k, v]) => (
                        <div key={k} style={{ display: 'contents' }}>
                          <span style={{ color: '#475569', fontSize: 10 }}>{k}:</span>
                          <span style={{
                            color: k === 'flag_names' && String(v).includes('RST') ? '#f87171' : '#cbd5e1',
                            fontSize: 10,
                            fontWeight: k === 'flag_names' && String(v).includes('RST') ? 700 : 400,
                          }}>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {findingsByPkt[i] && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e293b' }}>
                    {findingsByPkt[i].map((f, fi) => (
                      <div key={fi} style={{
                        color: f.severity === 'error' ? '#fca5a5' : '#fde68a',
                        fontSize: 10, marginBottom: 4,
                      }}>
                        {f.description}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
