import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { L_COLOR } from '../../../utils/constants';

const DISPLAY_MODES = ['binary', 'hex', 'decimal'];

// Layer order matching protocol stack (top to bottom on wire)
const LAYER_WIRE_ORDER = [1, 2, 3, 4, 6, 7]; // preamble/eth first, then IP, TCP, TLS, payload

export default function BitstreamDisplay({ packet, active, onReplay }) {
  const { t } = useTranslation();
  const [displayMode, setDisplayMode] = useState('binary');

  if (!packet?.layers) return null;

  // Build layer-colored segments from the packet
  const segments = useMemo(
    () => buildLayerSegments(packet, displayMode),
    [packet, displayMode],
  );

  return (
    <div
      onClick={onReplay}
      style={{
        borderTop: '1px solid #1e293b',
        background: active ? '#0c0a09' : '#0a0f1a',
        padding: '8px 16px',
        flexShrink: 0,
        transition: 'background 0.3s',
        cursor: onReplay ? 'pointer' : 'default',
      }}
      title={onReplay ? t('helloChat.replayAnimation', 'Click to replay animation') : undefined}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: '#92400e', color: '#fff',
            fontSize: 9, fontWeight: 700,
            width: 22, height: 22, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            L1
          </span>
          <span style={{ color: '#92400e', fontSize: 10, fontWeight: 600 }}>
            {t('helloChat.physicalLayer', 'Physical Layer')}
          </span>
          {onReplay && !active && (
            <span style={{ color: '#64748b', fontSize: 9 }}>
              {t('helloChat.clickToReplay', '(click to replay)')}
            </span>
          )}
        </div>
        {/* Display mode toggle */}
        <div style={{ display: 'flex', gap: 4 }}
          onClick={e => e.stopPropagation()}
        >
          {DISPLAY_MODES.map(mode => (
            <button
              key={mode}
              onClick={() => setDisplayMode(mode)}
              style={{
                background: displayMode === mode ? '#92400e' : '#1e293b',
                border: 'none',
                color: displayMode === mode ? '#fff' : '#475569',
                fontSize: 9, fontWeight: 600,
                padding: '2px 8px', borderRadius: 3,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Scrolling bitstream */}
      <div style={{
        overflow: 'hidden',
        borderRadius: 6,
        background: '#0c0a09',
        border: '1px solid #1e293b',
        position: 'relative',
      }}>
        <div
          className={active ? 'pvz-bitstream-scroll' : ''}
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            lineHeight: 1.8,
            padding: '6px 12px',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            minWidth: '100%',
          }}
        >
          {renderSegments(segments)}
          {/* Duplicate for seamless scroll */}
          {active && (
            <>
              <span style={{ color: '#1e293b' }}> │ </span>
              {renderSegments(segments)}
            </>
          )}
        </div>
      </div>

      {/* Label */}
      <div style={{
        color: '#94a3b8', fontSize: 10, marginTop: 6, lineHeight: 1.5,
      }}>
        {t('helloChat.bitstreamLabel',
          'These bits would travel as electrical pulses through a cable or radio waves through WiFi.'
        )}
      </div>
    </div>
  );
}

function renderSegments(segments) {
  return segments.map((seg, i) => (
    <span key={i} style={{ color: seg.color }} title={`L${seg.layer} ${seg.label}`}>
      {seg.text}
      {i < segments.length - 1 ? ' ' : ''}
    </span>
  ));
}

function buildLayerSegments(packet, mode) {
  const segments = [];

  const toStr = (b) => {
    switch (mode) {
      case 'hex':
        return b.toString(16).padStart(2, '0');
      case 'decimal':
        return b.toString(10).padStart(3, ' ');
      case 'binary':
      default:
        return b.toString(2).padStart(8, '0');
    }
  };

  const sep = ' ';

  // Generate synthetic bytes per layer based on field bit counts
  // Wire order: L1 (preamble) → L2 (Ethernet) → L3 (IP) → L4 (TCP) → L6 (TLS) → L7 (WebSocket+payload)
  const wireOrder = [1, 2, 3, 4, 6, 7];

  for (const layerNum of wireOrder) {
    const layer = packet.layers[layerNum];
    if (!layer) continue;

    let totalBits = 0;
    for (const field of layer.fields) {
      totalBits += field.bits;
    }

    const byteCount = Math.max(1, Math.ceil(totalBits / 8));
    // Use real payload bytes for L7, synthetic for others
    let bytes;
    if (layerNum === 7 && packet.payloadBytes) {
      // Show actual payload bytes + some header overhead
      const overhead = Math.max(0, byteCount - packet.payloadBytes.length);
      const headerBytes = new Uint8Array(overhead);
      crypto.getRandomValues(headerBytes);
      bytes = new Uint8Array(byteCount);
      bytes.set(headerBytes, 0);
      bytes.set(packet.payloadBytes, overhead);
    } else {
      bytes = new Uint8Array(byteCount);
      crypto.getRandomValues(bytes);
    }

    const color = L_COLOR[layerNum];
    const text = Array.from(bytes).map(toStr).join(sep);

    segments.push({
      layer: layerNum,
      label: layer.name,
      color,
      text,
    });
  }

  return segments;
}
