import { useState, useMemo, useCallback } from 'react';

/**
 * Format byte count to human-readable KB/MB/GB.
 */
function formatBytes(bytes) {
  if (bytes == null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration in milliseconds to a readable string.
 */
function formatDuration(ms) {
  if (ms == null || ms <= 0) return '--';
  if (ms < 1) return `${(ms * 1000).toFixed(0)} us`;
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}m ${secs}s`;
}

/**
 * Get duration value from a flow object, handling both durationMs and duration fields.
 */
function getFlowDuration(flow) {
  if (flow.durationMs != null) return flow.durationMs;
  if (flow.duration != null) return flow.duration * 1000; // convert seconds to ms
  return 0;
}

/**
 * Protocol color badge mapping.
 */
const PROTOCOL_COLORS = {
  TCP:   { bg: '#1e3a5f', color: '#60a5fa' },
  TLS:   { bg: '#3b1f6e', color: '#a78bfa' },
  DNS:   { bg: '#1a3a2a', color: '#4ade80' },
  UDP:   { bg: '#3b2f1a', color: '#fbbf24' },
  HTTP:  { bg: '#1e3a5f', color: '#38bdf8' },
  HTTPS: { bg: '#3b1f6e', color: '#c4b5fd' },
  QUIC:  { bg: '#3b2f1a', color: '#fb923c' },
  ICMP:  { bg: '#3b1a1a', color: '#f87171' },
  ARP:   { bg: '#1a3a2a', color: '#86efac' },
  RoCEv2:{ bg: '#1e3a5f', color: '#93c5fd' },
};

function getProtocolBadgeStyle(protocol) {
  // Try exact match first, then match on individual components (e.g., "TCP/TLS" -> try "TLS", "TCP")
  let entry = PROTOCOL_COLORS[protocol];
  if (!entry && protocol) {
    const parts = protocol.split('/');
    // Prefer later (more specific) component: "TCP/TLS" -> TLS takes priority
    for (let i = parts.length - 1; i >= 0; i--) {
      entry = PROTOCOL_COLORS[parts[i]];
      if (entry) break;
    }
  }
  entry = entry || { bg: '#1e293b', color: '#94a3b8' };
  return {
    background: entry.bg,
    color: entry.color,
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 3,
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap',
  };
}

const SORT_KEYS = ['name', 'protocol', 'serverAddr', 'packetCount', 'duration', 'bytes'];
const SORT_LABELS = {
  name: 'Server Name',
  protocol: 'Protocol',
  serverAddr: 'Server IP:Port',
  packetCount: 'Packets',
  duration: 'Duration',
  bytes: 'Bytes',
};

function sortFlows(flows, sortKey, sortDir) {
  return [...flows].sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case 'name':
        va = (a.serverName || a.serverIp || '').toLowerCase();
        vb = (b.serverName || b.serverIp || '').toLowerCase();
        break;
      case 'protocol':
        va = (a.protocol || '').toLowerCase();
        vb = (b.protocol || '').toLowerCase();
        break;
      case 'serverAddr':
        va = `${a.serverIp || ''}:${a.serverPort || 0}`;
        vb = `${b.serverIp || ''}:${b.serverPort || 0}`;
        break;
      case 'packetCount':
        va = a.packetCount || 0;
        vb = b.packetCount || 0;
        break;
      case 'duration':
        va = getFlowDuration(a);
        vb = getFlowDuration(b);
        break;
      case 'bytes':
        va = a.bytes || 0;
        vb = b.bytes || 0;
        break;
      default:
        va = 0; vb = 0;
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

export default function FlowPicker({ flows, onConfirm, onCancel }) {
  const [selected, setSelected] = useState(() => new Set(flows.map(f => f.id)));
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('packetCount');
  const [sortDir, setSortDir] = useState('desc');

  const totalPackets = useMemo(
    () => flows.reduce((sum, f) => sum + (f.packetCount || 0), 0),
    [flows],
  );

  const filteredFlows = useMemo(() => {
    if (!search.trim()) return sortFlows(flows, sortKey, sortDir);
    const q = search.toLowerCase();
    const filtered = flows.filter(f => {
      const name = (f.serverName || '').toLowerCase();
      const ip = (f.serverIp || '').toLowerCase();
      const proto = (f.protocol || '').toLowerCase();
      const clientIp = (f.clientIp || '').toLowerCase();
      return name.includes(q) || ip.includes(q) || proto.includes(q) || clientIp.includes(q);
    });
    return sortFlows(filtered, sortKey, sortDir);
  }, [flows, search, sortKey, sortDir]);

  const selectedPacketCount = useMemo(
    () => flows.filter(f => selected.has(f.id)).reduce((sum, f) => sum + (f.packetCount || 0), 0),
    [flows, selected],
  );

  const handleToggle = useCallback((id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(flows.map(f => f.id)));
  }, [flows]);

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleSelectMatching = useCallback(() => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const f of filteredFlows) next.add(f.id);
      return next;
    });
  }, [filteredFlows]);

  const handleConfirm = useCallback(() => {
    onConfirm(Array.from(selected));
  }, [selected, onConfirm]);

  const handleHeaderClick = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'protocol' || key === 'serverAddr' ? 'asc' : 'desc');
    }
  }, [sortKey]);

  const sortIndicator = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div style={{
      background: '#0f172a',
      borderBottom: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      maxHeight: '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px 8px',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              color: '#e2e8f0',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
            }}>
              Select Network Flows
            </span>
            <span style={{
              background: '#0c1929',
              color: '#93c5fd',
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 3,
            }}>
              {flows.length} flow{flows.length !== 1 ? 's' : ''}
            </span>
            <span style={{
              background: '#0c1929',
              color: '#94a3b8',
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 3,
            }}>
              {totalPackets} packet{totalPackets !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Search bar + bulk actions row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name, IP, or protocol..."
            style={{
              flex: 1,
              background: '#020817',
              border: '1px solid #334155',
              color: '#e2e8f0',
              borderRadius: 4,
              padding: '5px 8px',
              fontSize: 11,
              fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
              outline: 'none',
            }}
          />
          {search.trim() && (
            <button
              onClick={handleSelectMatching}
              style={{
                background: 'none',
                border: '1px solid #334155',
                color: '#93c5fd',
                padding: '4px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              Select Matching
            </button>
          )}
          <button
            onClick={handleSelectAll}
            style={{
              background: 'none',
              border: '1px solid #334155',
              color: '#64748b',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}
          >
            Select All
          </button>
          <button
            onClick={handleDeselectAll}
            style={{
              background: 'none',
              border: '1px solid #334155',
              color: '#64748b',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div style={{
        display: 'flex',
        padding: '6px 12px',
        background: '#0a0f1a',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
        fontSize: 9,
        fontWeight: 700,
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        userSelect: 'none',
      }}>
        <span style={{ width: 32 }} />
        <span
          onClick={() => handleHeaderClick('name')}
          style={{ flex: 2, cursor: 'pointer', minWidth: 0 }}
        >
          Server Name{sortIndicator('name')}
        </span>
        <span
          onClick={() => handleHeaderClick('protocol')}
          style={{ width: 70, cursor: 'pointer' }}
        >
          Protocol{sortIndicator('protocol')}
        </span>
        <span
          onClick={() => handleHeaderClick('serverAddr')}
          style={{ width: 160, cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}
        >
          Server IP:Port{sortIndicator('serverAddr')}
        </span>
        <span
          onClick={() => handleHeaderClick('packetCount')}
          style={{ width: 70, textAlign: 'right', cursor: 'pointer' }}
        >
          Packets{sortIndicator('packetCount')}
        </span>
        <span
          onClick={() => handleHeaderClick('duration')}
          style={{ width: 80, textAlign: 'right', cursor: 'pointer' }}
        >
          Duration{sortIndicator('duration')}
        </span>
        <span
          onClick={() => handleHeaderClick('bytes')}
          style={{ width: 80, textAlign: 'right', cursor: 'pointer' }}
        >
          Bytes{sortIndicator('bytes')}
        </span>
      </div>

      {/* Flow rows */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filteredFlows.length === 0 ? (
          <div style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: '#475569',
            fontSize: 11,
          }}>
            No flows match the current filter.
          </div>
        ) : (
          filteredFlows.map((flow, i) => {
            const isChecked = selected.has(flow.id);
            const displayName = flow.serverName || flow.serverIp || 'Unknown';

            return (
              <div
                key={flow.id}
                onClick={() => handleToggle(flow.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '5px 12px',
                  cursor: 'pointer',
                  background: i % 2 === 0 ? '#020817' : '#0a0f1a',
                  fontSize: 11,
                  transition: 'background 0.1s',
                  borderLeft: isChecked ? '3px solid #3b82f6' : '3px solid transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#020817' : '#0a0f1a'}
              >
                <span style={{ width: 32, flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => handleToggle(flow.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
                  />
                </span>
                <span style={{
                  flex: 2,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#e2e8f0',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  {displayName}
                  {flow.serverName && flow.serverIp && (
                    <span style={{ color: '#475569', fontSize: 9 }}>
                      ({flow.clientIp || ''})
                    </span>
                  )}
                </span>
                <span style={{ width: 70, flexShrink: 0 }}>
                  <span style={getProtocolBadgeStyle(flow.protocol)}>
                    {flow.protocol || '?'}
                  </span>
                </span>
                <span style={{
                  width: 160,
                  flexShrink: 0,
                  color: '#94a3b8',
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {flow.serverIp || '--'}:{flow.serverPort || '--'}
                </span>
                <span style={{
                  width: 70,
                  textAlign: 'right',
                  flexShrink: 0,
                  color: '#94a3b8',
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                }}>
                  {flow.packetCount || 0}
                </span>
                <span style={{
                  width: 80,
                  textAlign: 'right',
                  flexShrink: 0,
                  color: '#64748b',
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                }}>
                  {formatDuration(getFlowDuration(flow))}
                </span>
                <span style={{
                  width: 80,
                  textAlign: 'right',
                  flexShrink: 0,
                  color: '#64748b',
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 10,
                }}>
                  {formatBytes(flow.bytes)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid #1e293b',
        background: '#0a0f1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{
          color: '#94a3b8',
          fontSize: 11,
          fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
        }}>
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{selected.size}</span>
          {' '}flow{selected.size !== 1 ? 's' : ''} selected
          {' '}
          <span style={{ color: '#64748b' }}>
            ({selectedPacketCount} packet{selectedPacketCount !== 1 ? 's' : ''})
          </span>
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '1px solid #334155',
              color: '#64748b',
              padding: '6px 16px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            style={{
              background: selected.size === 0
                ? '#334155'
                : 'linear-gradient(135deg, #1e40af, #7c3aed)',
              border: 'none',
              color: selected.size === 0 ? '#64748b' : '#fff',
              padding: '6px 16px',
              borderRadius: 4,
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
            }}
          >
            Analyze Selected
          </button>
        </div>
      </div>
    </div>
  );
}
