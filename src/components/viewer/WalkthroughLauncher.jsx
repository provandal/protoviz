import { useState, useRef, useEffect } from 'react';
import useWalkthrough from '../../hooks/useWalkthrough';

const btnStyle = {
  background: 'linear-gradient(135deg, #3b82f620, #8b5cf620)',
  border: '1px solid #3b82f644',
  color: '#93c5fd',
  padding: '4px 10px',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  transition: 'all 0.15s',
  fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
  whiteSpace: 'nowrap',
};

const dropdownStyle = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: 4,
  minWidth: 220,
  zIndex: 200,
  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
};

const dropdownItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  color: '#e2e8f0',
  padding: '8px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
  transition: 'background 0.15s',
};

export default function WalkthroughLauncher() {
  const { hasWalkthroughs, walkthroughs, isWalkthroughActive, startWalkthrough } = useWalkthrough();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!hasWalkthroughs || isWalkthroughActive) return null;

  const handleLaunch = (id) => {
    startWalkthrough(id);
    setOpen(false);
  };

  // Single walkthrough: direct launch
  if (walkthroughs.length === 1) {
    return (
      <button
        onClick={() => handleLaunch(walkthroughs[0].id)}
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#e2e8f0'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#3b82f644'; e.currentTarget.style.color = '#93c5fd'; }}
        title={walkthroughs[0].description || 'Start guided walkthrough'}
      >
        Guided Tour
      </button>
    );
  }

  // Multiple walkthroughs: dropdown
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={btnStyle}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#e2e8f0'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#3b82f644'; e.currentTarget.style.color = '#93c5fd'; }}
      >
        Guided Tour {'\u25BC'}
      </button>
      {open && (
        <div style={dropdownStyle}>
          {walkthroughs.map(wt => (
            <button
              key={wt.id}
              onClick={() => handleLaunch(wt.id)}
              style={dropdownItemStyle}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{wt.title}</div>
              {wt.description && (
                <div style={{ color: '#64748b', fontSize: 10 }}>{wt.description}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
