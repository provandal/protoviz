import { useTranslation } from 'react-i18next';
import useChatStore from '../../../store/chatStore';
import { L_COLOR } from '../../../utils/constants';

const LAYER_ORDER = [7, 6, 4, 3, 2, 1]; // L5 (session) is handled by WebSocket/TCP, skip

export default function ProtocolPanel({ activeLayer, animating }) {
  const { t } = useTranslation();
  const currentPacket = useChatStore(s => s.currentPacket);
  const selectedField = useChatStore(s => s.selectedField);
  const setSelectedField = useChatStore(s => s.setSelectedField);

  if (!currentPacket) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#94a3b8', fontSize: 14,
        padding: 40, textAlign: 'center', lineHeight: 1.8,
      }}>
        {t('helloChat.noPacket', 'Send or receive a message to see the protocol layers.')}
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '0.1em',
        marginBottom: 4,
      }}>
        {t('helloChat.protocolStack', 'Protocol Stack')}
        {currentPacket.totalBytes && (
          <span style={{ marginInlineStart: 8, color: '#475569', fontWeight: 400 }}>
            {currentPacket.totalBytes} bytes
          </span>
        )}
      </div>

      {LAYER_ORDER.map(layerNum => {
        const layer = currentPacket.layers[layerNum];
        if (!layer) return null;

        const isActive = activeLayer === layerNum;
        const isPast = animating && activeLayer != null && (
          useChatStore.getState().animationDirection === 'down'
            ? layerNum > activeLayer
            : layerNum < activeLayer
        );
        const color = L_COLOR[layerNum];

        return (
          <div
            key={layerNum}
            className={isActive ? 'pvz-layer-active' : ''}
            style={{
              '--layer-color': color,
              background: isActive ? `${color}15` : '#0a0f1a',
              border: `1px solid ${isActive ? color : '#1e293b'}`,
              borderRadius: 8,
              opacity: animating && !isActive && !isPast ? 0.3 : 1,
              transition: 'opacity 0.3s, border-color 0.3s, background 0.3s',
              overflow: 'hidden',
            }}
          >
            {/* Layer header */}
            <div style={{
              padding: '8px 12px',
              display: 'flex', alignItems: 'center', gap: 8,
              borderBottom: `1px solid ${isActive ? color + '44' : '#1e293b'}`,
            }}>
              <span style={{
                background: color, color: '#fff',
                fontSize: 9, fontWeight: 700,
                width: 22, height: 22, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                L{layerNum}
              </span>
              <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 600 }}>
                {layer.name}
              </span>
            </div>

            {/* Fields */}
            <div style={{ padding: '4px 0' }}>
              {layer.fields.map((field, idx) => {
                const isSelected = selectedField?.abbrev === field.abbrev;
                return (
                  <div
                    key={field.abbrev || idx}
                    onClick={() => setSelectedField(isSelected ? null : field)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 12px',
                      cursor: 'pointer',
                      background: isSelected ? `${color}20` : 'transparent',
                      borderInlineStart: isSelected ? `3px solid ${color}` : '3px solid transparent',
                      transition: 'background 0.15s',
                      borderStyle: field.synthetic ? undefined : undefined,
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) e.currentTarget.style.background = '#0f172a';
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* Field name */}
                    <span style={{
                      color: '#94a3b8', fontSize: 11, minWidth: 120,
                      borderBottom: field.synthetic ? '1px dashed #475569' : 'none',
                    }}>
                      {field.name}
                    </span>
                    {/* Bits */}
                    {field.bits > 0 && (
                      <span style={{
                        color: '#475569', fontSize: 9,
                        fontFamily: "'IBM Plex Mono', monospace",
                        minWidth: 40,
                      }}>
                        {field.bits}b
                      </span>
                    )}
                    {/* Value */}
                    <span style={{
                      color: '#e2e8f0', fontSize: 11,
                      fontFamily: "'IBM Plex Mono', monospace",
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', flex: 1,
                    }}>
                      {field.value}
                    </span>
                    {/* Synthetic indicator */}
                    {field.synthetic && (
                      <span style={{
                        color: '#475569', fontSize: 8,
                        border: '1px dashed #475569', borderRadius: 3,
                        padding: '0px 4px',
                      }}>
                        sim
                      </span>
                    )}
                    {/* Endianness badge */}
                    {field.endianness && (
                      <span style={{
                        color: '#facc15', fontSize: 8, fontWeight: 700,
                        background: '#422006', border: '1px solid #854d0e44',
                        borderRadius: 3, padding: '0px 4px',
                      }}>
                        endian
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
