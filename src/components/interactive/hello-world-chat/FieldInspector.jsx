import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useChatStore from '../../../store/chatStore';
import { L_COLOR } from '../../../utils/constants';

export default function FieldInspector() {
  const { t } = useTranslation();
  const selectedField = useChatStore(s => s.selectedField);
  const setSelectedField = useChatStore(s => s.setSelectedField);
  const [endiannessExpanded, setEndiannessExpanded] = useState(false);

  if (!selectedField) return null;

  const layerNum = getLayerForField(selectedField.abbrev);
  const color = L_COLOR[layerNum] || '#3b82f6';

  // Compute hex representation of value
  const hexValue = computeHex(selectedField);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: color, color: '#fff',
            fontSize: 9, fontWeight: 700,
            width: 22, height: 22, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            L{layerNum}
          </span>
          <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700 }}>
            {selectedField.name}
          </span>
        </div>
        <button
          onClick={() => setSelectedField(null)}
          style={{
            background: 'none', border: 'none', color: '#64748b',
            cursor: 'pointer', fontSize: 16, padding: '2px 6px',
          }}
        >
          ×
        </button>
      </div>

      {/* Synthetic notice */}
      {selectedField.synthetic && (
        <div style={{
          background: '#1e293b', border: '1px dashed #475569',
          borderRadius: 6, padding: '8px 12px',
          fontSize: 11, color: '#94a3b8', lineHeight: 1.6,
        }}>
          {t('helloChat.syntheticField', 'This field is simulated — in this mode, the value is generated to show you what it would look like on a real network.')}
        </div>
      )}

      {/* Value card */}
      <div style={{
        background: '#0f172a', border: `1px solid ${color}44`,
        borderRadius: 8, padding: 12,
      }}>
        <div style={{ color: '#64748b', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
          {t('helloChat.fieldValue', 'Value')}
        </div>
        <div style={{
          color: '#e2e8f0', fontSize: 16, fontWeight: 600,
          fontFamily: "'IBM Plex Mono', monospace",
          wordBreak: 'break-all',
        }}>
          {selectedField.value}
        </div>
        {hexValue && (
          <div style={{
            color: '#475569', fontSize: 11, marginTop: 4,
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            hex: {hexValue}
          </div>
        )}
        {selectedField.bits > 0 && (
          <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
            {selectedField.bits} bits ({Math.ceil(selectedField.bits / 8)} bytes)
          </div>
        )}
      </div>

      {/* Description — "Why does this matter?" */}
      <div>
        <div style={{ color: '#64748b', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>
          {t('helloChat.whyMatters', 'Why does this matter?')}
        </div>
        <div style={{
          color: '#94a3b8', fontSize: 12, lineHeight: 1.8,
        }}>
          {selectedField.desc}
        </div>
      </div>

      {/* Endianness teaching section */}
      {selectedField.endianness && (
        <div style={{
          background: '#422006', border: '1px solid #854d0e',
          borderRadius: 8, padding: 12,
        }}>
          <div
            onClick={() => setEndiannessExpanded(!endiannessExpanded)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: '#facc15', fontSize: 12, fontWeight: 700 }}>
              {t('helloChat.endiannessTitle', 'Endianness: Network Byte Order')}
            </span>
            <span style={{ color: '#facc15', fontSize: 14 }}>
              {endiannessExpanded ? '▲' : '▼'}
            </span>
          </div>
          {endiannessExpanded && (
            <div style={{ marginTop: 12, color: '#fde68a', fontSize: 11, lineHeight: 1.8 }}>
              <p style={{ marginBottom: 8 }}>
                {t('helloChat.endiannessExplain',
                  'Your CPU (x86) stores this number as least-significant byte first (little-endian). But the network standard (RFC 1700) requires most-significant byte first (big-endian). This is called "network byte order."'
                )}
              </p>
              <div style={{
                background: '#1c1917', borderRadius: 6, padding: 10,
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                marginBottom: 8,
              }}>
                <div style={{ color: '#94a3b8', marginBottom: 4 }}>
                  {t('helloChat.hostOrder', 'Host order (little-endian):')}
                </div>
                <div style={{ color: '#ef4444' }}>
                  {formatEndiannessExample(selectedField.value, 'little')}
                </div>
                <div style={{ color: '#94a3b8', marginTop: 8, marginBottom: 4 }}>
                  {t('helloChat.networkOrder', 'Network order (big-endian):')}
                </div>
                <div style={{ color: '#4ade80' }}>
                  {formatEndiannessExample(selectedField.value, 'big')}
                </div>
              </div>
              <p style={{ marginBottom: 8 }}>
                {t('helloChat.endiannessC',
                  'In C, you convert with: htons() for 16-bit, htonl() for 32-bit (host-to-network). And ntohs()/ntohl() for the reverse.'
                )}
              </p>
              <div style={{
                background: '#1c1917', borderRadius: 6, padding: 10,
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                color: '#e2e8f0',
              }}>
                <span style={{ color: '#64748b' }}>// The bug:</span><br />
                header-&gt;total_length = {selectedField.value};<br />
                <span style={{ color: '#64748b' }}>// The fix:</span><br />
                header-&gt;total_length = <span style={{ color: '#4ade80' }}>htons</span>({selectedField.value});
              </div>
              <a
                href="#/byte-order-endianness"
                style={{
                  color: '#facc15', fontSize: 11, marginTop: 12,
                  display: 'inline-block', textDecoration: 'none',
                }}
              >
                → {t('helloChat.endiannessScenario', 'Full endianness scenario')}
              </a>
            </div>
          )}
        </div>
      )}

      {/* RFC / Spec link */}
      {selectedField.rfc && (
        <div style={{
          color: '#475569', fontSize: 10, borderTop: '1px solid #1e293b',
          paddingTop: 12,
        }}>
          <span style={{ fontWeight: 600 }}>Spec: </span>
          {selectedField.rfc}
        </div>
      )}
    </div>
  );
}

function getLayerForField(abbrev) {
  if (!abbrev) return 7;
  if (abbrev.startsWith('ws.')) return 7;
  if (abbrev.startsWith('tls.')) return 6;
  if (abbrev.startsWith('tcp.')) return 4;
  if (abbrev.startsWith('ip.')) return 3;
  if (abbrev.startsWith('eth.')) return 2;
  if (abbrev.startsWith('phy.')) return 1;
  return 7;
}

function computeHex(field) {
  const val = field.value;
  if (val.startsWith('0x')) return val;
  const num = parseInt(val, 10);
  if (!isNaN(num) && field.bits > 0) {
    return '0x' + (num >>> 0).toString(16).padStart(Math.ceil(field.bits / 4), '0');
  }
  return null;
}

function formatEndiannessExample(value, order) {
  const num = parseInt(value, 10);
  if (isNaN(num)) return value;
  const hex = (num & 0xFFFF).toString(16).padStart(4, '0');
  const hi = hex.slice(0, 2);
  const lo = hex.slice(2, 4);
  if (order === 'little') {
    return `[0x${lo}] [0x${hi}]  (addr +0 = 0x${lo}, addr +1 = 0x${hi})`;
  }
  return `[0x${hi}] [0x${lo}]  (addr +0 = 0x${hi}, addr +1 = 0x${lo})`;
}
