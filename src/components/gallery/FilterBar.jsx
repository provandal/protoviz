const selectStyle = {
  background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
  fontSize: 11, borderRadius: 4, padding: '6px 10px', cursor: 'pointer',
  outline: 'none',
};

export default function FilterBar({ filter, onFilterChange, protocols, difficulties }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '16px 24px',
      maxWidth: 1000, margin: '0 auto',
      flexWrap: 'wrap', alignItems: 'center',
    }}>
      <input
        type="text"
        placeholder="Search scenarios..."
        value={filter.search}
        onChange={e => onFilterChange({ ...filter, search: e.target.value })}
        style={{
          ...selectStyle,
          flex: 1, minWidth: 200,
          color: '#e2e8f0',
        }}
      />
      <select
        value={filter.protocol}
        onChange={e => onFilterChange({ ...filter, protocol: e.target.value })}
        style={selectStyle}
      >
        <option value="">All Protocols</option>
        {protocols.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select
        value={filter.difficulty}
        onChange={e => onFilterChange({ ...filter, difficulty: e.target.value })}
        style={selectStyle}
      >
        <option value="">All Levels</option>
        {difficulties.map(d => (
          <option key={d} value={d} style={{ textTransform: 'capitalize' }}>{d}</option>
        ))}
      </select>
      {(filter.search || filter.protocol || filter.difficulty) && (
        <button
          onClick={() => onFilterChange({ protocol: '', difficulty: '', search: '' })}
          style={{
            background: 'none', border: '1px solid #334155', color: '#64748b',
            fontSize: 10, padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
    </div>
  );
}
