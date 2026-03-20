import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

function formatTimestamp(pkt, baseTimestamp) {
  const relative = pkt.timestamp - baseTimestamp;
  const secs = Math.floor(relative);
  const frac = relative - secs;
  const usec = Math.round(frac * 1e6);
  return `${secs}.${String(usec).padStart(6, '0')}`;
}

export default function PacketList({ packets, findings, selectedIndex, onPacketSelect, onConversationView }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const selectedRef = useRef(null);
  const menuRef = useRef(null);
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

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e, pkt, i) => {
    e.preventDefault();
    // Only show if packet has IP layer (needed for conversation filtering)
    const ip = pkt.layers.find(l => l.name === 'IPv4' || l.name === 'IPv6');
    if (!ip) return;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      packetIndex: i,
      srcIp: ip.fields.src_ip,
      dstIp: ip.fields.dst_ip,
    });
  }, []);

  const handleViewConversation = useCallback(() => {
    if (!contextMenu) return;
    onConversationView?.(contextMenu.srcIp, contextMenu.dstIp);
    setContextMenu(null);
  }, [contextMenu, onConversationView]);

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
        <span style={{ width: 50 }}>{t('packetList.colNumber')}</span>
        <span style={{ width: 110 }}>{t('packetList.colTime')}</span>
        <span style={{ flex: 1 }}>{t('packetList.colSummary')}</span>
        <span style={{ width: 60, textAlign: 'right' }}>{t('packetList.colLength')}</span>
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
              onContextMenu={(e) => handleContextMenu(e, pkt, i)}
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
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      L{layer.layer} — {layer.name}
                      {layer._sensitive && (
                        <span style={{
                          background: '#78350f', color: '#fbbf24', fontSize: 9,
                          padding: '1px 5px', borderRadius: 3, fontWeight: 600,
                        }} title={layer._sensitive.map(m => m.name).join(', ')}>
                          {t('packetList.sensitiveData')}
                        </span>
                      )}
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

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: 4,
            zIndex: 1000,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            minWidth: 220,
          }}
        >
          <div
            onClick={handleViewConversation}
            style={{
              padding: '8px 12px',
              color: '#e2e8f0',
              fontSize: 11,
              cursor: 'pointer',
              borderRadius: 4,
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#334155'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {t('packetList.viewConversation')}
            <div style={{ color: '#64748b', fontSize: 9, marginTop: 2 }}>
              {contextMenu.srcIp} ↔ {contextMenu.dstIp}
            </div>
          </div>
          <div
            onClick={() => setContextMenu(null)}
            style={{
              padding: '6px 12px',
              color: '#64748b',
              fontSize: 10,
              cursor: 'pointer',
              borderRadius: 4,
              borderTop: '1px solid #334155',
              marginTop: 2,
              paddingTop: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
            onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          >
            {t('packetList.cancel')}
          </div>
        </div>
      )}
    </div>
  );
}
