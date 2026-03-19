/**
 * Lightweight language selector for ProtoViz.
 *
 * Designed to be replaced with GeoLingua (<GeoLingua />) once the package
 * is published to npm. Integration point: onLanguageSelect callback receives
 * a BCP 47 locale string, same as GeoLingua's API.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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

export default function LanguageSelector() {
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
    i18n.changeLanguage(code);
    localStorage.setItem('protoviz_locale', code);
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
