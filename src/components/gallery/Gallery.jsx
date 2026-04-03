/* global __APP_VERSION__ */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ScenarioCard from './ScenarioCard';
import FilterBar from './FilterBar';
import ProtocolFamilySection, { PROTOCOL_FAMILY_ORDER } from './ProtocolFamilySection';
import LanguageSelector from '../common/LanguageSelector';
import { loadGalleryTranslations, translateScenario } from '../../utils/galleryTranslation';

function GettingStarted({ navigate, t }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('protoviz_gs_dismissed') !== '1'; } catch { return true; }
  });

  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem('protoviz_gs_dismissed', '1'); } catch {}
  };

  if (!open) {
    return (
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            background: 'none', border: 'none', color: '#475569',
            fontSize: 11, cursor: 'pointer', padding: '4px 12px',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        >
          {t('gallery.gsShow')}
        </button>
      </div>
    );
  }

  const cards = [
    {
      key: 'learn',
      icon: '\u25B6',
      color: '#3b82f6',
      title: t('gallery.gsLearnTitle'),
      desc: t('gallery.gsLearnDesc'),
    },
    {
      key: 'analyze',
      icon: '\u{1F50D}',
      color: '#8b5cf6',
      title: t('gallery.gsAnalyzeTitle'),
      desc: t('gallery.gsAnalyzeDesc'),
      action: () => navigate('/troubleshooter'),
    },
    {
      key: 'live',
      icon: '\u{1F4AC}',
      color: '#0ea5e9',
      title: t('gallery.gsLiveTitle'),
      desc: t('gallery.gsLiveDesc'),
      action: () => navigate('/live/hello-world-chat'),
    },
    {
      key: 'create',
      icon: '\u{1F4DD}',
      color: '#10b981',
      title: t('gallery.gsCreateTitle'),
      desc: t('gallery.gsCreateDesc'),
      action: () => navigate('/create'),
    },
  ];

  return (
    <div style={{
      marginBottom: 24, padding: 16,
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        <div style={{
          color: '#475569', fontSize: 9, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          {t('gallery.gettingStarted')}
        </div>
        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', color: '#475569',
            fontSize: 11, cursor: 'pointer', padding: '2px 8px',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#94a3b8'}
          onMouseLeave={e => e.currentTarget.style.color = '#475569'}
        >
          {t('gallery.gsDismiss')}
        </button>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}>
        {cards.map(c => (
          <div
            key={c.key}
            onClick={c.action}
            style={{
              padding: '12px 14px', background: '#0a0f1a',
              border: '1px solid #1e293b', borderRadius: 6,
              cursor: c.action ? 'pointer' : 'default',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => { if (c.action) e.currentTarget.style.borderColor = c.color; }}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e293b'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{c.icon}</span>
              <span style={{ color: c.color, fontSize: 12, fontWeight: 700 }}>{c.title}</span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributingOverlay({ onClose, t }) {
  const sectionStyle = { marginBottom: 20 };
  const headingStyle = {
    color: '#475569', fontSize: 9, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
  };
  const textStyle = { color: '#94a3b8', fontSize: 12, lineHeight: 1.7 };
  const codeStyle = {
    background: '#020817', color: '#a5f3fc', fontSize: 11,
    padding: '8px 12px', borderRadius: 4, display: 'block',
    fontFamily: "'IBM Plex Mono', monospace", marginTop: 6, lineHeight: 1.6,
    overflowX: 'auto', whiteSpace: 'pre',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
          padding: '28px 24px', maxWidth: 600, width: '90%',
          maxHeight: '80vh', overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 800 }}>
            {t('contributing.title')}
          </span>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
            {t('contributing.intro')}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.devSetup')}</div>
          <code style={codeStyle}>
{`git clone https://github.com/provandal/protoviz.git
cd protoviz && npm install
npm run dev`}
          </code>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.addScenarios')}</div>
          <div style={textStyle}>
            <strong style={{ color: '#60a5fa' }}>{t('contributing.scenarioCreator')}</strong>
            {' \u2014 '}{t('contributing.scenarioCreatorDesc')}
          </div>
          <div style={{ ...textStyle, marginTop: 8 }}>
            <strong style={{ color: '#60a5fa' }}>{t('contributing.fromPcap')}</strong>
            {' \u2014 '}{t('contributing.fromPcapDesc')}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.yamlStructure')}</div>
          <div style={textStyle}>{t('contributing.yamlStructureDesc')}</div>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.prRequirements')}</div>
          <div style={textStyle}>
            {t('contributing.prRequirementsDesc')}
          </div>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.rulesAndDissectors')}</div>
          <div style={textStyle}>{t('contributing.rulesAndDissectorsDesc')}</div>
        </div>

        <div style={sectionStyle}>
          <div style={headingStyle}>{t('contributing.codeStyle')}</div>
          <div style={textStyle}>{t('contributing.codeStyleDesc')}</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <a
            href="https://github.com/provandal/protoviz/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#60a5fa', fontSize: 12, fontWeight: 600,
              textDecoration: 'none', display: 'inline-block', marginBottom: 16,
            }}
          >
            {t('contributing.viewOnGithub')} &#8599;
          </a>
          <br />
          <button
            onClick={onClose}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              padding: '6px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutOverlay({ onClose, onOpenContributing, t }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
          padding: '32px 28px', maxWidth: 520, width: '90%',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            borderRadius: 8, padding: '4px 14px', display: 'inline-block', marginBottom: 16,
          }}>
            <span style={{ color: '#fff', fontSize: 20, fontWeight: 800, letterSpacing: '0.05em' }}>
              PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
            </span>
          </div>

          <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7, marginBottom: 24 }}>
            {t('gallery.aboutDescription')}
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
                {t('gallery.authorTitle')}
              </div>
            </div>
            <div>
              <div style={{ color: '#a78bfa', fontSize: 13, fontWeight: 700 }}>
                Claude.AI &amp; Claude Code
              </div>
              <div style={{ color: '#64748b', fontSize: 10 }}>
                {t('gallery.aiContributors')} &middot; {t('gallery.byAnthropic')}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
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
            <button
              onClick={onOpenContributing}
              style={{
                background: 'none', color: '#64748b', fontSize: 11,
                border: '1px solid #1e293b', padding: '4px 12px', borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {t('contributing.title')}
            </button>
            <span style={{ color: '#64748b', fontSize: 11, padding: '4px 0' }}>
              {t('gallery.mitLicense')}
            </span>
            <span style={{ color: '#64748b', fontSize: 11, padding: '4px 0' }}>
              v{__APP_VERSION__}
            </span>
          </div>

          <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.6, maxWidth: 440, margin: '0 auto 20px' }}>
            {t('gallery.disclaimer')}
          </div>

          <button
            onClick={onClose}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              padding: '6px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600,
            }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Gallery() {
  const { t, i18n } = useTranslation();
  const [scenarios, setScenarios] = useState([]);
  const [galleryTrans, setGalleryTrans] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ protocol: '', difficulty: '', search: '' });
  const [showAbout, setShowAbout] = useState(false);
  const [showContributing, setShowContributing] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    fetch(`${base}scenarios/index.json`)
      .then(r => r.json())
      .then(data => { setScenarios(data.scenarios); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Load gallery translations when language changes
  useEffect(() => {
    loadGalleryTranslations(i18n.language).then(setGalleryTrans);
  }, [i18n.language]);

  // Apply translations to scenarios
  const translatedScenarios = useMemo(
    () => scenarios.map(s => translateScenario(s, galleryTrans)),
    [scenarios, galleryTrans],
  );

  const filtered = translatedScenarios.filter(s => {
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

  const hasFilter = !!(filter.search || filter.difficulty);
  const singleFamily = !!(filter.protocol && !filter.search && !filter.difficulty);

  const groupedFiltered = useMemo(() => {
    const groups = {};
    for (const s of filtered) {
      const fam = s.protocol_family || 'Other';
      (groups[fam] ||= []).push(s);
    }
    const ordered = [];
    for (const fam of PROTOCOL_FAMILY_ORDER) {
      if (groups[fam]) ordered.push({ family: fam, scenarios: groups[fam] });
    }
    for (const fam of Object.keys(groups)) {
      if (!PROTOCOL_FAMILY_ORDER.includes(fam)) {
        ordered.push({ family: fam, scenarios: groups[fam] });
      }
    }
    return ordered;
  }, [filtered]);

  const toggleSection = (family) => {
    setExpandedSections(prev => ({ ...prev, [family]: !prev[family] }));
  };

  const isSectionExpanded = (family) => {
    if (hasFilter) return true; // auto-expand when search/difficulty filter active
    if (expandedSections[family] !== undefined) return expandedSections[family];
    return false; // collapsed by default
  };

  const protocols = [...new Set(scenarios.map(s => s.protocol_family))];
  const difficulties = [...new Set(scenarios.map(s => s.difficulty))];

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
      overflow: 'hidden',
    }}>
      {/* Header — compact */}
      <div style={{
        padding: '12px 24px', textAlign: 'center',
        borderBottom: '1px solid #1e293b', background: '#0a0f1a',
        position: 'relative',
      }}>
        <div style={{ position: 'absolute', top: 10, insetInlineEnd: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <LanguageSelector />
          <button
            onClick={() => setShowContributing(true)}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#64748b',
              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'color 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = '#10b981'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#334155'; }}
          >
            {t('contributing.title')}
          </button>
          <button
            onClick={() => setShowAbout(true)}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#64748b',
              padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'color 0.2s, border-color 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = '#3b82f6'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#334155'; }}
          >
            {t('gallery.aboutTitle')}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            borderRadius: 10, padding: '5px 16px', display: 'inline-block',
          }}>
            <span style={{ color: '#fff', fontSize: 22, fontWeight: 800, letterSpacing: '0.05em' }}>
              PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
            </span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 12, maxWidth: 400 }}>
            {t('gallery.tagline')}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        filter={filter}
        onFilterChange={setFilter}
        protocols={protocols}
        difficulties={difficulties}
      />

      {/* Scrollable content — Getting Started + Scenario grid */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
          <GettingStarted navigate={navigate} t={t} />

          {loading ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>
              {t('gallery.loading')}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', padding: 40 }}>
              {t('gallery.noMatch')}
            </div>
          ) : singleFamily ? (
            /* Single family selected — flat grid, no section chrome */
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}>
              {filtered.map(s => (
                <ScenarioCard
                  key={s.slug}
                  scenario={s}
                  onClick={() => navigate(
                    s.type === 'interactive' ? `/live/${s.slug}` : `/${s.slug}`
                  )}
                />
              ))}
            </div>
          ) : (
            groupedFiltered.map(group => (
              <ProtocolFamilySection
                key={group.family}
                family={group.family}
                scenarios={group.scenarios}
                expanded={isSectionExpanded(group.family)}
                onToggle={() => toggleSection(group.family)}
                onScenarioClick={(s) => navigate(
                  s.type === 'interactive' ? `/live/${s.slug}` : `/${s.slug}`
                )}
              />
            ))
          )}
        </div>
      </div>

      {/* Overlays */}
      {showAbout && (
        <AboutOverlay
          onClose={() => setShowAbout(false)}
          onOpenContributing={() => { setShowAbout(false); setShowContributing(true); }}
          t={t}
        />
      )}
      {showContributing && <ContributingOverlay onClose={() => setShowContributing(false)} t={t} />}
    </div>
  );
}
