export default function LinkTooltip({ link, state, mousePos, t }) {
  if (!link) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: mousePos.y + 14,
        left: mousePos.x + 14,
        background: 'rgba(15,23,42,0.98)',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 11,
        color: '#e2e8f0',
        pointerEvents: 'none',
        zIndex: 1000,
        minWidth: 220,
        maxWidth: 320,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 4 }}>
        {link.src} &rarr; {link.dst}
      </div>
      <div style={{ color: '#94a3b8', marginBottom: 6, fontSize: 10 }}>
        {link.capacity_gbps} Gbps capacity
      </div>

      {state && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 12px', marginBottom: 6, fontSize: 10 }}>
          <span style={{ color: '#64748b' }}>{t('netsim.utilization')}</span>
          <span style={{ color: '#e2e8f0', fontFamily: "'IBM Plex Mono', monospace" }}>
            {state.util_pct.toFixed(1)}%
          </span>
          <span style={{ color: '#64748b' }}>{t('netsim.throughput')}</span>
          <span style={{ color: '#e2e8f0', fontFamily: "'IBM Plex Mono', monospace" }}>
            {state.throughput_gbps.toFixed(1)} Gbps
          </span>
          {state.pfc_pauses > 0 && (
            <>
              <span style={{ color: '#64748b' }}>{t('netsim.pfcPauses')}</span>
              <span style={{ color: '#f59e0b', fontFamily: "'IBM Plex Mono', monospace" }}>
                {state.pfc_pauses}
              </span>
            </>
          )}
          {state.drops > 0 && (
            <>
              <span style={{ color: '#64748b' }}>{t('netsim.drops')}</span>
              <span style={{ color: '#ef4444', fontFamily: "'IBM Plex Mono', monospace" }}>
                {state.drops}
              </span>
            </>
          )}
        </div>
      )}

      {link.packet_scenario && (
        <div style={{
          marginTop: 6, paddingTop: 6, borderTop: '1px solid #1e293b',
          color: '#a78bfa', fontSize: 10, fontWeight: 600,
        }}>
          {'\u25B6 '}{t('netsim.clickForPacketView')}
        </div>
      )}
    </div>
  );
}
