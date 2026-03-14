/* global __APP_VERSION__ */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ScenarioCard from './ScenarioCard';
import FilterBar from './FilterBar';

export default function Gallery() {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ protocol: '', difficulty: '', search: '' });
  const navigate = useNavigate();

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}scenarios/index.json`)
      .then(r => r.json())
      .then(data => { setScenarios(data.scenarios); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = scenarios.filter(s => {
    if (filter.protocol && s.protocol_family !== filter.protocol) return false;
    if (filter.difficulty && s.difficulty !== filter.difficulty) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      return s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q));
    }
    return true;
  });

  const protocols = [...new Set(scenarios.map(s => s.protocol_family))];
  const difficulties = [...new Set(scenarios.map(s => s.difficulty))];

  return (
    <div style={{
      minHeight: '100vh', background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '40px 24px 24px', textAlign: 'center',
        borderBottom: '1px solid #1e293b', background: '#0a0f1a',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          borderRadius: 12, padding: '8px 20px', display: 'inline-block', marginBottom: 16,
        }}>
          <span style={{ color: '#fff', fontSize: 28, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <div style={{ color: '#94a3b8', fontSize: 14, maxWidth: 500, margin: '0 auto', marginBottom: 16 }}>
          Interactive protocol visualizations for network engineers, students,
          and anyone curious about what happens on the wire.
        </div>
        <button
          onClick={() => navigate('/troubleshooter')}
          style={{
            background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
            padding: '8px 20px', borderRadius: 6, cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            transition: 'border-color 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#e2e8f0'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94a3b8'; }}
        >
          PCAP Troubleshooter
        </button>
      </div>

      {/* Filter bar */}
      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        protocols={protocols}
        difficulties={difficulties}
      />

      {/* Scenario grid */}
      <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>
            Loading scenarios...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>
            No scenarios match your filters
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
          }}>
            {filtered.map(s => (
              <ScenarioCard
                key={s.slug}
                scenario={s}
                onClick={() => navigate(`/${s.slug}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* About section */}
      <div style={{
        padding: '40px 24px', borderTop: '1px solid #1e293b', marginTop: 40,
        background: '#0a0f1a',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ color: '#475569', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            About
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7, marginBottom: 24 }}>
            ProtoViz is an open-source platform for creating, sharing, and interactively
            exploring protocol exchange scenarios. Each scenario is a YAML file describing
            a complete protocol interaction — with every frame field annotated with spec
            references and Linux kernel source cross-links.
          </div>

          <div style={{
            display: 'flex', justifyContent: 'center', gap: 32,
            flexWrap: 'wrap', marginBottom: 24,
          }}>
            <div>
              <a
                href="https://www.linkedin.com/in/erik-smith-a899ba3/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
              >
                Erik Smith
              </a>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                Dell &middot; Chair, SNIA DSN Community
              </div>
            </div>
            <div>
              <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>
                Claude.AI &amp; Claude Code
              </div>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                AI Contributors &middot; by Anthropic
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
            <a
              href="https://github.com/provandal/protoviz"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#64748b', fontSize: 11, textDecoration: 'none',
                border: '1px solid #1e293b', padding: '4px 12px', borderRadius: 4,
              }}
            >
              GitHub
            </a>
            <span style={{ color: '#1e293b', fontSize: 11, padding: '4px 0' }}>
              MIT License
            </span>
            <span style={{ color: '#334155', fontSize: 11, padding: '4px 0' }}>
              v{__APP_VERSION__}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
