import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { L_COLOR } from '../../utils/constants';
import PacketField from './PacketField';

function PayloadBlock({ hdr, highlightFields = [] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  return (
    <div style={{
      margin: '4px 10px 4px 10px',
      border: '1px solid #47556944',
      borderLeft: '3px solid #475569',
      borderRadius: 4,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 8px', background: '#1e293b44', cursor: 'pointer',
        }}
      >
        <span style={{
          background: '#475569', color: '#cbd5e1', fontSize: 9,
          fontWeight: 700, padding: '1px 5px', borderRadius: 3,
        }}>Payload</span>
        <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 600, flex: 1 }}>{hdr.name}</span>
        <span style={{ color: '#475569', fontSize: 10 }}>{open ? '\u25BC' : '\u25B6'}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '22px 160px 1fr 120px', padding: '2px 8px', marginBottom: 2 }}>
            {[t('inspector.headerBits'), t('inspector.headerField'), t('inspector.headerName'), t('inspector.headerValue')].map(h => (
              <span key={h} style={{ color: '#475569', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
            ))}
          </div>
          {hdr.fields.map((f, i) => <PacketField key={i} field={f} highlightFields={highlightFields} />)}
        </div>
      )}
    </div>
  );
}

export default function HeaderBlock({ hdr, highlightFields = [] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const layerColor = L_COLOR[hdr.layer] || '#475569';

  return (
    <div style={{ marginBottom: 6, border: `1px solid ${layerColor}44`, borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: `${layerColor}22`, cursor: 'pointer' }}
      >
        <span style={{ background: layerColor, color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3 }}>L{hdr.layer}</span>
        <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600, flex: 1 }}>{hdr.name}</span>
        <span style={{ color: '#475569', fontSize: 10 }}>{open ? '\u25BC' : '\u25B6'}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '22px 160px 1fr 120px', padding: '2px 8px', marginBottom: 2 }}>
            {[t('inspector.headerBits'), t('inspector.headerField'), t('inspector.headerName'), t('inspector.headerValue')].map(h => (
              <span key={h} style={{ color: '#475569', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
            ))}
          </div>
          {hdr.fields.map((f, i) => <PacketField key={i} field={f} highlightFields={highlightFields} />)}
          {hdr.children && hdr.children.map((child, i) => (
            <PayloadBlock key={i} hdr={child} highlightFields={highlightFields} />
          ))}
        </div>
      )}
    </div>
  );
}
