import { useTranslation } from 'react-i18next';
import ScenarioCard from './ScenarioCard';

const FAMILY_META = {
  'TCP/IP':       { color: '#3b82f6', icon: '\u{1F310}' },
  'IPv6':         { color: '#0ea5e9', icon: '\u{1F6F0}' },
  'Interconnect Fundamentals': { color: '#f59e0b', icon: '\u{1F4E1}' },
  'RDMA':         { color: '#8b5cf6', icon: '\u26A1' },
  'NVMe-oF':      { color: '#10b981', icon: '\u{1F4BE}' },
  'SAN':          { color: '#ec4899', icon: '\u{1F5A7}' },
  'Storage':      { color: '#f97316', icon: '\u{1F680}' },
  'Fabric Scenarios': { color: '#f97316', icon: '\u{1F578}' },
};

const FAMILY_I18N_KEY = {
  'TCP/IP': 'tcpIp',
  'IPv6': 'ipv6',
  'Interconnect Fundamentals': 'interconnect',
  'RDMA': 'rdma',
  'NVMe-oF': 'nvmeOf',
  'SAN': 'san',
  'Storage': 'storage',
  'Fabric Scenarios': 'fabric',
};

export const PROTOCOL_FAMILY_ORDER = [
  'TCP/IP', 'IPv6', 'Interconnect Fundamentals',
  'RDMA', 'NVMe-oF', 'SAN', 'Storage', 'Fabric Scenarios',
];

export default function ProtocolFamilySection({ family, scenarios, expanded, onToggle, onScenarioClick }) {
  const { t } = useTranslation();
  const meta = FAMILY_META[family] || { color: '#64748b', icon: '\u{1F4C1}' };
  const i18nKey = FAMILY_I18N_KEY[family] || family;
  const name = t(`protocolFamily.${i18nKey}`, family);
  const desc = t(`protocolFamily.${i18nKey}Desc`, '');

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Section header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px', background: '#0f172a',
          border: '1px solid #1e293b', borderRadius: 8,
          borderLeft: `3px solid ${meta.color}`,
          cursor: 'pointer', textAlign: 'left',
          transition: 'border-color 0.2s, background 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#131c2e'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#0f172a'; }}
      >
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700 }}>{name}</span>
            <span style={{
              background: '#1e293b', color: meta.color,
              fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 10,
            }}>
              {scenarios.length}
            </span>
          </div>
          {desc && (
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
              {desc}
            </div>
          )}
        </div>
        <span style={{
          color: '#475569', fontSize: 14, fontWeight: 700,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
        }}>
          &#9654;
        </span>
      </button>

      {/* Scenario grid */}
      {expanded && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16, marginTop: 12, paddingLeft: 6,
        }}>
          {scenarios.map(s => (
            <ScenarioCard
              key={s.slug}
              scenario={s}
              onClick={() => onScenarioClick(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
