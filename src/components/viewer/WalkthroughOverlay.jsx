import useWalkthrough from '../../hooks/useWalkthrough';

const overlayStyle = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 100,
  pointerEvents: 'none',
};

const cardWrapperStyle = {
  padding: '0 16px 12px',
  pointerEvents: 'auto',
};

const cardStyle = {
  background: '#0f172a',
  border: '2px solid transparent',
  borderImage: 'linear-gradient(135deg, #3b82f6, #8b5cf6) 1',
  borderRadius: 0, // borderImage doesn't work with borderRadius, so we use outline trick
  padding: '14px 16px',
  position: 'relative',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
};

const cardInnerStyle = {
  background: '#0f172a',
  borderRadius: 8,
  border: '2px solid transparent',
  padding: '14px 16px',
  position: 'relative',
  boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
  outline: '2px solid #3b82f680',
  outlineOffset: 1,
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 10,
};

const titleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const badgeStyle = {
  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  color: '#fff',
  fontSize: 9,
  fontWeight: 800,
  padding: '2px 8px',
  borderRadius: 4,
  letterSpacing: '0.05em',
};

const progressStyle = {
  color: '#94a3b8',
  fontSize: 11,
  fontWeight: 600,
};

const closeBtnStyle = {
  background: 'none',
  border: '1px solid #334155',
  color: '#64748b',
  width: 24,
  height: 24,
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'color 0.15s, border-color 0.15s',
};

const narrationStyle = {
  color: '#cbd5e1',
  fontSize: 13,
  lineHeight: 1.7,
  marginBottom: 12,
  maxHeight: 120,
  overflowY: 'auto',
};

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const navBtnStyle = (enabled) => ({
  background: enabled ? '#1e293b' : '#0f172a',
  border: `1px solid ${enabled ? '#334155' : '#1e293b'}`,
  color: enabled ? '#e2e8f0' : '#334155',
  padding: '5px 14px',
  borderRadius: 5,
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontSize: 11,
  fontWeight: 600,
  transition: 'color 0.15s, border-color 0.15s, background 0.15s',
  fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
});

export default function WalkthroughOverlay() {
  const {
    isWalkthroughActive,
    currentNarration,
    walkthroughProgress,
    currentWalkthrough,
    exitWalkthrough,
    nextWalkthroughStep,
    prevWalkthroughStep,
  } = useWalkthrough();

  if (!isWalkthroughActive || !currentWalkthrough) return null;

  const { current, total } = walkthroughProgress;
  const canPrev = current > 1;
  const canNext = current < total;

  return (
    <div style={overlayStyle}>
      <div style={cardWrapperStyle}>
        <div style={cardInnerStyle}>
          {/* Header */}
          <div style={headerStyle}>
            <div style={titleStyle}>
              <span style={badgeStyle}>GUIDED TOUR</span>
              <span style={progressStyle}>Step {current} of {total}</span>
            </div>
            <button
              onClick={exitWalkthrough}
              style={closeBtnStyle}
              title="Exit walkthrough"
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#334155'; }}
            >
              {'\u2715'}
            </button>
          </div>

          {/* Narration */}
          <div style={narrationStyle}>
            {currentNarration}
          </div>

          {/* Navigation footer */}
          <div style={footerStyle}>
            <button
              onClick={canPrev ? prevWalkthroughStep : undefined}
              style={navBtnStyle(canPrev)}
              disabled={!canPrev}
              onMouseEnter={e => { if (canPrev) { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#1e3a5f'; } }}
              onMouseLeave={e => { if (canPrev) { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.background = '#1e293b'; } }}
            >
              {'\u25C0'} Previous
            </button>
            <div style={{ display: 'flex', gap: 3 }}>
              {Array.from({ length: total }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === current - 1 ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: i === current - 1
                      ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)'
                      : i < current - 1
                        ? '#3b82f680'
                        : '#1e293b',
                    transition: 'all 0.2s',
                    display: 'inline-block',
                  }}
                />
              ))}
            </div>
            <button
              onClick={canNext ? nextWalkthroughStep : undefined}
              style={navBtnStyle(canNext)}
              disabled={!canNext}
              onMouseEnter={e => { if (canNext) { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#1e3a5f'; } }}
              onMouseLeave={e => { if (canNext) { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.background = '#1e293b'; } }}
            >
              Next {'\u25B6'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
