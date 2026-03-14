/* global __APP_VERSION__ */

export default function AboutPanel() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', padding: 32,
      color: '#e2e8f0', gap: 24,
    }}>
      {/* Logo */}
      <div style={{
        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        borderRadius: 12, padding: '10px 20px',
      }}>
        <span style={{ color: '#fff', fontSize: 24, fontWeight: 800, letterSpacing: '0.05em' }}>
          PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
        </span>
      </div>

      <div style={{ color: '#475569', fontSize: 11 }}>
        v{__APP_VERSION__}
      </div>

      <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', lineHeight: 1.8, maxWidth: 420 }}>
        Interactive protocol education platform for network engineers,
        students, and anyone curious about what happens on the wire.
      </div>

      {/* Authors */}
      <div style={{
        background: '#0f172a', borderRadius: 8, padding: '16px 24px',
        border: '1px solid #1e293b', maxWidth: 420, width: '100%',
      }}>
        <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          Created By
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <a
              href="https://www.linkedin.com/in/erik-smith-a899ba3/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
            >
              Erik Smith
            </a>
            <div style={{ color: '#64748b', fontSize: 11 }}>
              Distinguished Engineer - Dell Technologies
            </div>
          </div>
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10 }}>
            <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>
              Claude.AI &amp; Claude Code
            </div>
            <div style={{ color: '#64748b', fontSize: 11 }}>
              AI Contributors &middot; by Anthropic
            </div>
          </div>
        </div>
      </div>

      {/* Links */}
      <div style={{ display: 'flex', gap: 16 }}>
        <a
          href="https://github.com/provandal/protoviz"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#64748b', fontSize: 11, textDecoration: 'none',
            border: '1px solid #1e293b', padding: '4px 12px', borderRadius: 4,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
        >
          GitHub
        </a>
        <span style={{ color: '#1e293b', fontSize: 11, padding: '4px 0' }}>
          MIT License
        </span>
      </div>
    </div>
  );
}
