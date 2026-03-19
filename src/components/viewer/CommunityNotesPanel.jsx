import { useTranslation } from 'react-i18next';
import useViewerStore from '../../store/viewerStore';
import useCommunityNotes, { buildDiscussionUrl } from '../../hooks/useCommunityNotes';

function formatDate(dateStr, locale) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(locale || undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function NoteCard({ note, locale, t }) {
  return (
    <div style={{
      background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
      padding: 12, marginBottom: 8,
    }}>
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {note.avatarUrl && (
          <img
            src={note.avatarUrl}
            alt={note.author}
            style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }}
          />
        )}
        <span style={{ color: '#93c5fd', fontSize: 11, fontWeight: 600 }}>
          {note.author}
        </span>
        <span style={{ color: '#475569', fontSize: 10 }}>
          {formatDate(note.date, locale)}
        </span>
        {note.field && (
          <span style={{
            background: '#1e3a5f', color: '#7dd3fc', fontSize: 9, fontWeight: 600,
            padding: '1px 6px', borderRadius: 3, marginInlineStart: 'auto',
          }}>
            {note.field}
          </span>
        )}
      </div>

      {/* Note title */}
      {note.title && (
        <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          {note.title}
        </div>
      )}

      {/* Note text */}
      <div style={{
        color: '#94a3b8', fontSize: 11, lineHeight: 1.6,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {note.text}
      </div>

      {/* Link to discussion */}
      {note.url && (
        <a
          href={note.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', marginTop: 8,
            color: '#60a5fa', fontSize: 10, textDecoration: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
        >
          {t('community.viewOnGithub')} &rarr;
        </a>
      )}
    </div>
  );
}

export default function CommunityNotesPanel() {
  const { t, i18n } = useTranslation();
  const step = useViewerStore(s => s.step);
  const slug = useViewerStore(s => s.currentSlug);
  const scenario = useViewerStore(s => s.scenario);
  const { getNotesForStep, loading, error } = useCommunityNotes(slug);
  const locale = i18n.language || 'en';

  const notes = getNotesForStep(step);
  const scenarioTitle = scenario?.meta?.title || slug;
  const shareUrl = buildDiscussionUrl(slug, step, scenarioTitle);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: 16, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            color: '#475569', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {t('community.title')}
          </span>
          <span style={{
            color: '#60a5fa', fontSize: 10, fontWeight: 600,
          }}>
            {t('community.stepLabel', { step: step + 1 })}
          </span>
        </div>
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: '#1e3a5f', border: '1px solid #2563eb44',
            color: '#93c5fd', padding: '4px 10px', borderRadius: 4,
            cursor: 'pointer', fontSize: 10, fontWeight: 600,
            textDecoration: 'none',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1e40af'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#1e3a5f'; e.currentTarget.style.color = '#93c5fd'; }}
        >
          {t('community.shareNote')}
        </a>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ color: '#475569', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>
          {t('community.loading')}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 11, padding: '8px 0' }}>
          {error}
        </div>
      )}

      {/* Notes list */}
      {!loading && notes.length > 0 && (
        <div>
          {notes.map((note, i) => (
            <NoteCard key={`${note.author}-${note.date}-${i}`} note={note} locale={locale} t={t} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && notes.length === 0 && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 16px', textAlign: 'center',
        }}>
          <div style={{ color: '#475569', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
            {t('community.noNotesTitle')}
          </div>
          <div style={{ color: '#334155', fontSize: 11, lineHeight: 1.5, maxWidth: 320, marginBottom: 16 }}>
            {t('community.noNotesDescription')}
          </div>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: '#1e3a5f', border: '1px solid #2563eb44',
              color: '#93c5fd', padding: '6px 16px', borderRadius: 5,
              cursor: 'pointer', fontSize: 11, fontWeight: 600,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1e40af'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1e3a5f'; e.currentTarget.style.color = '#93c5fd'; }}
          >
            {t('community.shareViaGithub')}
          </a>
        </div>
      )}
    </div>
  );
}
