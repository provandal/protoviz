const DIFFICULTY_COLORS = {
  beginner: { bg: '#052e16', color: '#4ade80', border: '#16a34a' },
  intermediate: { bg: '#172554', color: '#60a5fa', border: '#2563eb' },
  advanced: { bg: '#3b0764', color: '#c084fc', border: '#7c3aed' },
};

export default function ScenarioCard({ scenario, onClick }) {
  const diff = DIFFICULTY_COLORS[scenario.difficulty] || DIFFICULTY_COLORS.intermediate;

  return (
    <div
      onClick={onClick}
      style={{
        background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
        padding: 20, cursor: 'pointer',
        transition: 'border-color 0.2s, transform 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = '#3b82f6';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '#1e293b';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Protocol + Difficulty */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{
          background: '#1e293b', color: '#94a3b8',
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
        }}>
          {scenario.protocol}
        </span>
        <span style={{
          background: diff.bg, color: diff.color,
          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
          border: `1px solid ${diff.border}44`,
          textTransform: 'capitalize',
        }}>
          {scenario.difficulty}
        </span>
      </div>

      {/* Title */}
      <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700, marginBottom: 8, lineHeight: 1.4 }}>
        {scenario.title}
      </div>

      {/* Description */}
      <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
        {scenario.description}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {scenario.tags.map(tag => (
          <span key={tag} style={{
            background: '#1e293b', color: '#475569',
            fontSize: 9, padding: '1px 6px', borderRadius: 3,
          }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
