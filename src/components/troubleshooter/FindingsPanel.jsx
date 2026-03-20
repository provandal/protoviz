import { useTranslation } from 'react-i18next';

const SEVERITY_STYLES = {
  error: { bg: '#450a0a', border: '#dc2626', color: '#fca5a5', label: 'ERROR' },
  warning: { bg: '#451a03', border: '#d97706', color: '#fde68a', label: 'WARN' },
  info: { bg: '#0c1929', border: '#2563eb', color: '#93c5fd', label: 'INFO' },
};

export default function FindingsPanel({ findings, onFindingClick }) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 12 }}>
      <div style={{
        color: '#475569', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        marginBottom: 12, padding: '0 4px',
      }}>
        {t('findings.title', { count: findings.length })}
      </div>
      {findings.map((f, i) => {
        const sev = SEVERITY_STYLES[f.severity] || SEVERITY_STYLES.info;
        return (
          <div
            key={i}
            onClick={() => onFindingClick?.(f.packetIndex)}
            style={{
              background: sev.bg, border: `1px solid ${sev.border}44`,
              borderRadius: 6, padding: '10px 12px', marginBottom: 8,
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = sev.border}
            onMouseLeave={e => e.currentTarget.style.borderColor = `${sev.border}44`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                background: `${sev.border}33`, color: sev.color,
                fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2,
              }}>
                {sev.label}
              </span>
              <span style={{ color: '#475569', fontSize: 9 }}>
                {t('findings.packetNumber', { number: f.packetIndex + 1 })}
              </span>
              <span style={{ color: '#334155', fontSize: 9, marginLeft: 'auto' }}>
                {t('findings.clickToView')}
              </span>
            </div>
            <div style={{ color: sev.color, fontSize: 11, lineHeight: 1.5 }}>
              {f.description}
            </div>
            {f.spec_ref && (
              <div style={{ color: '#475569', fontSize: 9, marginTop: 4 }}>
                {t('findings.ref', { ref: f.spec_ref })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
