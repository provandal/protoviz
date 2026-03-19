import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useViewerStore from '../../store/viewerStore';
import useAnnotations from '../../hooks/useAnnotations';
import { startAlign } from '../../utils/rtl';

export default function EventDetail({ event, phaseColor }) {
  const { t } = useTranslation();
  const setActiveBottomTab = useViewerStore(s => s.setActiveBottomTab);
  const step = useViewerStore(s => s.step);
  const slug = useViewerStore(s => s.currentSlug);
  const { getNote, setNote, exportAnnotations, importAnnotations, count } = useAnnotations(slug);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!event) return null;

  const note = getNote(step);

  const startEdit = () => {
    setDraft(note);
    setEditing(true);
  };

  const saveEdit = () => {
    setNote(step, draft);
    setEditing(false);
  };

  const handleExport = () => {
    const json = exportAnnotations();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protoviz-notes-${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const text = await file.text();
        importAnnotations(text);
      }
    };
    input.click();
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: 16, overflowY: 'auto',
    }}>
      {/* Phase badge + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          background: `${phaseColor}22`, color: phaseColor,
          fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
          border: `1px solid ${phaseColor}44`,
        }}>
          {event.phase}
        </span>
        <span style={{ color: phaseColor, fontSize: 14, fontWeight: 700 }}>
          {event.label}
        </span>
      </div>

      {/* Detail text */}
      {event.detail && (
        <div style={{
          color: '#94a3b8', fontSize: 12, lineHeight: 1.7,
          maxWidth: 700, marginBottom: 16,
        }}>
          {event.detail}
        </div>
      )}

      {/* State changes */}
      {event.state && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('eventDetail.stateChanges')}
          </div>
          {Object.entries(event.state).map(([actorId, layers]) => (
            <div key={actorId} style={{ marginBottom: 4 }}>
              {Object.entries(layers).map(([layerNum, fields]) => (
                <div key={layerNum} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
                  <span style={{ color: '#64748b', fontSize: 11, minWidth: 80 }}>
                    {actorId} L{layerNum}:
                  </span>
                  <span style={{ color: '#cbd5e1', fontSize: 11 }}>
                    {Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* View packet button */}
      {event.frame && (
        <button
          onClick={() => setActiveBottomTab('inspect')}
          style={{
            background: '#1e293b', border: '1px solid #334155',
            color: '#94a3b8', padding: '6px 14px', borderRadius: 5,
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
            alignSelf: 'flex-start', marginBottom: 16, direction: 'ltr',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e2e8f0'; e.currentTarget.style.borderColor = '#3b82f6'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.borderColor = '#334155'; }}
        >
          {t('eventDetail.viewPacket')}
        </button>
      )}

      {/* Annotation / Notes */}
      <div style={{
        marginTop: 'auto', paddingTop: 12,
        borderTop: '1px solid #1e293b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('eventDetail.yourNotes')}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {count > 0 && (
              <button
                onClick={handleExport}
                style={{ background: 'none', border: '1px solid #1e293b', color: '#475569', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 9 }}
              >
                {t('eventDetail.export', { count })}
              </button>
            )}
            <button
              onClick={handleImport}
              style={{ background: 'none', border: '1px solid #1e293b', color: '#475569', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 9 }}
            >
              {t('eventDetail.import')}
            </button>
          </div>
        </div>

        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
              placeholder={t('eventDetail.notePlaceholder')}
              rows={3}
              style={{
                background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                fontSize: 11, padding: '8px 10px', borderRadius: 4, outline: 'none',
                resize: 'vertical', fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={saveEdit}
                style={{ background: '#1e40af', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
              >
                {t('eventDetail.save')}
              </button>
              <button
                onClick={() => setEditing(false)}
                style={{ background: 'none', border: '1px solid #334155', color: '#64748b', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}
              >
                {t('eventDetail.cancel')}
              </button>
            </div>
          </div>
        ) : note ? (
          <div
            onClick={startEdit}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
              padding: '8px 10px', cursor: 'pointer',
              color: '#cbd5e1', fontSize: 11, lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {note}
          </div>
        ) : (
          <button
            onClick={startEdit}
            style={{
              background: 'none', border: '1px dashed #1e293b', color: '#334155',
              padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, width: '100%', textAlign: startAlign(),
            }}
          >
            {t('eventDetail.addNote')}
          </button>
        )}
      </div>
    </div>
  );
}
