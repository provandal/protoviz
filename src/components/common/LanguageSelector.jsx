/**
 * Language selector for ProtoViz.
 *
 * Tries to load GeoLingua (npm install geolingua three) for the interactive
 * globe icon. Falls back gracefully to a built-in dropdown if not installed.
 *
 * To add GeoLingua to any project:
 *   npm install geolingua three
 *   import { GeoLingua } from 'geolingua';
 *   <GeoLingua initialMode="icon" theme="space" onLanguageSelect={fn} />
 */
import React, { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

// --- GeoLingua dynamic import (optional dependency) ---
// If geolingua is installed (npm install geolingua three), the globe icon
// appears. If not, Vite's optionalDep plugin resolves it to an empty module
// and only the dropdown is shown. No crash either way.
let geoLinguaModule = null;
const geoLinguaReady = import('geolingua')
  .then(m => {
    if (m.GeoLingua) geoLinguaModule = m;
  })
  .catch(() => {});

const GeoLinguaLazy = lazy(() =>
  import('geolingua').then(m => {
    if (!m.GeoLingua) throw new Error('geolingua not installed');
    return { default: m.GeoLingua };
  })
);

const LANGUAGES = [
  { code: 'en',    flag: '🇺🇸', name: 'English' },
  { code: 'es',    flag: '🇪🇸', name: 'Español' },
  { code: 'fr',    flag: '🇫🇷', name: 'Français' },
  { code: 'de',    flag: '🇩🇪', name: 'Deutsch' },
  { code: 'pt-BR', flag: '🇧🇷', name: 'Português (BR)' },
  { code: 'ru',    flag: '🇷🇺', name: 'Русский' },
  { code: 'uk',    flag: '🇺🇦', name: 'Українська' },
  { code: 'zh-CN', flag: '🇨🇳', name: '中文 (简体)' },
  { code: 'ja',    flag: '🇯🇵', name: '日本語' },
  { code: 'ko',    flag: '🇰🇷', name: '한국어' },
  { code: 'hi',    flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'he',    flag: '🇮🇱', name: 'עברית' },
  { code: 'ar-LB', flag: '🇱🇧', name: 'العربية (لبنان)' },
  { code: 'ht',    flag: '🇭🇹', name: 'Kreyòl Ayisyen' },
];

// --- Dropdown selector (always available) ---

function DropdownSelector({ onLanguageSelect }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const current = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = (code) => {
    onLanguageSelect(code);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          color: '#94a3b8',
          padding: '5px 10px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          transition: 'border-color 0.2s, color 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#e2e8f0'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94a3b8'; }}
      >
        <span style={{ fontSize: 14 }}>{current.flag}</span>
        <span>{current.name}</span>
        <span style={{ fontSize: 8, marginInlineStart: 2 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          insetInlineEnd: 0,
          marginTop: 4,
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: 4,
          zIndex: 1000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          minWidth: 200,
          maxHeight: 320,
          overflowY: 'auto',
        }}>
          {LANGUAGES.map(lang => (
            <div
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              style={{
                padding: '7px 12px',
                cursor: 'pointer',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: lang.code === current.code ? '#60a5fa' : '#e2e8f0',
                fontWeight: lang.code === current.code ? 600 : 400,
                background: lang.code === current.code ? '#1e293b' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = lang.code === current.code ? '#1e293b' : 'transparent'}
            >
              <span style={{ fontSize: 14 }}>{lang.flag}</span>
              <span>{lang.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Error boundary for GeoLingua (catches import/render failures) ---

class GeoLinguaErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    // GeoLingua not installed or failed to render — silently fall back
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// --- GeoLingua globe icon + modal ---
// The icon shows in the header; clicking it opens a centered overlay with
// the full interactive globe. This avoids the popover-positioning issue
// where icon mode tries to open upward from the top of the page.

function GeoLinguaIcon({ onLanguageSelect }) {
  const [available, setAvailable] = useState(false);
  const [showGlobe, setShowGlobe] = useState(false);
  const base = import.meta.env.BASE_URL;
  const overlayRef = useRef(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    geoLinguaReady.then(() => {
      if (geoLinguaModule) setAvailable(true);
    });
  }, []);

  if (!available) return null;

  const handleSelect = (locale) => {
    onLanguageSelect(locale);
    // Auto-close only on real user interaction — browser detection fires
    // within milliseconds of mount, so skip if the overlay just opened
    if (showGlobe && Date.now() - openedAtRef.current > 1000) {
      setTimeout(() => setShowGlobe(false), 600);
    }
  };

  const handleOpen = () => {
    openedAtRef.current = Date.now();
    setShowGlobe(true);
  };

  return (
    <>
      {/* Globe icon button */}
      <button
        onClick={handleOpen}
        aria-label="Open language globe"
        title="GeoLingua"
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '2px solid #334155',
          background: '#1e293b',
          cursor: 'pointer',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.2s, transform 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <img
          src={`${base}geolingua-icon.png`}
          alt="GeoLingua"
          width={32}
          height={32}
          style={{ borderRadius: '50%', objectFit: 'cover' }}
        />
      </button>

      {/* Full-screen overlay with globe */}
      {showGlobe && (
        <div
          ref={overlayRef}
          onClick={(e) => { if (e.target === overlayRef.current) setShowGlobe(false); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div style={{
            width: 520,
            maxWidth: '95vw',
            height: 600,
            maxHeight: '90vh',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 16px 64px rgba(0,0,0,0.5)',
            position: 'relative',
          }}>
            {/* Close button */}
            <button
              onClick={() => setShowGlobe(false)}
              aria-label="Close"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                zIndex: 10,
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: '1px solid #334155',
                background: 'rgba(15, 23, 42, 0.8)',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>

            <GeoLinguaErrorBoundary>
              <Suspense fallback={
                <div style={{
                  width: '100%', height: '100%',
                  background: '#0a0f1a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#64748b', fontSize: 14,
                }}>
                  Loading globe...
                </div>
              }>
                <GeoLinguaLazy
                  initialMode="full"
                  theme="space"
                  onLanguageSelect={handleSelect}
                  showSkip={false}
                  voiceDetectionEnabled={true}
                  detectBrowserLanguage={true}
                  persist={false}
                  style={{ width: '100%', height: '100%' }}
                />
              </Suspense>
            </GeoLinguaErrorBoundary>
          </div>
        </div>
      )}
    </>
  );
}

// --- Main export ---

export default function LanguageSelector() {
  const { i18n } = useTranslation();

  const handleLanguageSelect = (code) => {
    i18n.changeLanguage(code);
    localStorage.setItem('protoviz_locale', code);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <GeoLinguaIcon onLanguageSelect={handleLanguageSelect} />
      <DropdownSelector onLanguageSelect={handleLanguageSelect} />
    </div>
  );
}
