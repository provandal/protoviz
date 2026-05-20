import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import yaml from 'js-yaml';
import FrameDiagram from './FrameDiagram';
import OverheadWaterfall from './OverheadWaterfall';
import LanguageSelector from '../common/LanguageSelector';
import {
  computeOverhead,
  formatBytes,
  effectiveUserRateGbps,
  variantLanes,
} from '../../utils/overheadCalc';

const BASE = import.meta.env.BASE_URL;

async function fetchYaml(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  const text = await res.text();
  return yaml.load(text);
}

// Presets carry a `families` filter listing which frame families they
// apply to. The bulk presets (`1mb`, `256mb`) set payload=null meaning
// "use the frame's max payload" — picked up at apply time.
// 'control' is intentionally absent — fixed-size control frames don't
// take user payload, so presets don't apply.
const ETH_FAMILIES = [
  'ethernet', 'esun', 'ip', 'tcp', 'udp', 'rdma', 'overlay',
  'nvme-tcp', 'security', 'application', 'fcoe', 'media',
];
const ALL_FAMILIES = [
  'ethernet', 'esun', 'fc', 'ip', 'tcp', 'udp', 'rdma', 'overlay',
  'nvme-tcp', 'security', 'application', 'fcoe', 'ib', 'media',
];

const PRESETS = [
  { id: '64b',      label: '64 B RPC',          payload: 64,    message: 64,
    families: ALL_FAMILIES },
  { id: 'mss',      label: 'TCP MSS (1460)',    payload: 1460,  message: 1460,
    families: ETH_FAMILIES },
  { id: 'jumbo',    label: 'Jumbo (9000)',      payload: 9000,  message: 9000,
    families: ETH_FAMILIES },
  { id: 'fc-data',  label: 'FC Data IU (2048)', payload: 2048,  message: 2048,
    families: ['fc'] },
  { id: 'esun-max', label: 'ESUN max (1496)',   payload: 1496,  message: 1496,
    families: ['esun'] },
  { id: '1mb',      label: '1 MB bulk',         payload: null,  message: 1024 * 1024,
    families: ALL_FAMILIES },
  { id: '256mb',    label: '256 MB tensor',     payload: null,  message: 256 * 1024 * 1024,
    families: ALL_FAMILIES },
];

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        color: '#64748b', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8,
      cursor: 'pointer', fontSize: 11,
      color: on ? '#e2e8f0' : '#64748b',
    }}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: '#22d3ee', width: 14, height: 14 }}
      />
      {label}
    </label>
  );
}

export default function FramesPage() {
  const navigate = useNavigate();
  const [frames, setFrames] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState(null);
  const [variantId, setVariantId] = useState(null);
  const [laneOptionId, setLaneOptionId] = useState(null);
  const [payloadBytes, setPayloadBytes] = useState(1460);
  const [messageBytes, setMessageBytes] = useState(1460);
  const [endianLE, setEndianLE] = useState(false);
  const [wireTime, setWireTime] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const indexData = await fetch(`${BASE}frames/index.json`).then(r => r.json());
        const framesData = await Promise.all(
          indexData.frames.map(f => fetchYaml(`frames/${f.path}`))
        );
        if (!cancelled) {
          setFrames(framesData);
          setSelectedFrameId(framesData[0]?.id || null);
          setVariantId(framesData[0]?.link_variants?.[0]?.id || null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) { setError(err.message); setLoading(false); }
      }
    }
    loadAll();
    return () => { cancelled = true; };
  }, []);

  const selectedFrame = useMemo(
    () => frames.find(f => f.id === selectedFrameId),
    [frames, selectedFrameId],
  );
  const selectedVariant = useMemo(
    () => selectedFrame?.link_variants?.find(v => v.id === variantId)
       || selectedFrame?.link_variants?.[0],
    [selectedFrame, variantId],
  );

  // Selected lane option (e.g. 400GbE → "8×50 PAM-4" vs "4×100 PAM-4").
  // When a variant has lane_options, the chosen entry's PHY fields override
  // the variant's top-level fields downstream.
  const selectedLaneOption = useMemo(() => {
    const opts = selectedVariant?.lane_options;
    if (!opts || opts.length === 0) return null;
    return opts.find(o => o.id === laneOptionId) || opts[0];
  }, [selectedVariant, laneOptionId]);

  // Merge lane option onto variant for math + display. When no lane_options,
  // the variant itself is used as-is.
  const effectiveVariant = useMemo(() => {
    if (!selectedVariant) return null;
    if (!selectedLaneOption) return selectedVariant;
    return { ...selectedVariant, ...selectedLaneOption };
  }, [selectedVariant, selectedLaneOption]);

  // When switching frames, reset the variant to the new frame's default
  // and snap payload/frame to the new frame's max (or default_bytes if
  // declared). Users typically want to start at "fully loaded" and slide
  // down toward minimum, not stay stranded at the previous frame's value.
  useEffect(() => {
    if (!selectedFrame) return;
    if (!selectedFrame.link_variants?.find(v => v.id === variantId)) {
      setVariantId(selectedFrame.link_variants?.[0]?.id || null);
    }
    const target =
      selectedFrame.payload?.default_bytes
      ?? selectedFrame.payload?.max_bytes
      ?? 1500;
    setPayloadBytes(target);
  }, [selectedFrame]); // eslint-disable-line react-hooks/exhaustive-deps

  // When switching variant, reset lane option to the variant's first option
  // (or null if the variant has no lane_options at all).
  useEffect(() => {
    const opts = selectedVariant?.lane_options;
    if (!opts || opts.length === 0) {
      setLaneOptionId(null);
      return;
    }
    if (!opts.find(o => o.id === laneOptionId)) {
      setLaneOptionId(opts[0].id);
    }
  }, [selectedVariant]); // eslint-disable-line react-hooks/exhaustive-deps

  const overhead = useMemo(() => {
    if (!selectedFrame || !effectiveVariant) return null;
    const jumbo = payloadBytes > (selectedFrame.payload?.max_bytes ?? Infinity);
    return computeOverhead({
      frame: selectedFrame,
      variant: effectiveVariant,
      messageBytes,
      payloadPerFrame: payloadBytes,
      jumbo,
    });
  }, [selectedFrame, effectiveVariant, payloadBytes, messageBytes]);

  function applyPreset(p) {
    const max = selectedFrame?.payload?.jumbo_max_bytes
              ?? selectedFrame?.payload?.max_bytes
              ?? 9000;
    const payload = p.payload === null ? max : Math.min(p.payload, max);
    setPayloadBytes(payload);
    setMessageBytes(p.message);
  }

  const payloadMax = selectedFrame?.payload?.jumbo_max_bytes
                  ?? selectedFrame?.payload?.max_bytes
                  ?? 9000;
  const payloadMin = selectedFrame?.payload?.min_bytes ?? 0;

  // Fixed-size control frames (PFC etc.) have no variable payload and
  // therefore no meaningful "message size" — hide those controls and
  // presets, show the frame as it is.
  const isControlFrame =
    selectedFrame?.kind === 'control'
    || (selectedFrame?.payload?.max_bytes ?? 0) <= 0;

  // Only show presets relevant to the selected frame's family.
  const visiblePresets = useMemo(() => {
    if (isControlFrame) return [];
    const fam = selectedFrame?.family;
    if (!fam) return PRESETS;
    return PRESETS.filter(p => p.families.includes(fam));
  }, [selectedFrame, isControlFrame]);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#020817',
      color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid #1e293b',
        background: '#0a0f1a',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div onClick={() => navigate('/')} style={{
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          borderRadius: 6, padding: '4px 8px', cursor: 'pointer',
        }}>
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#334155', fontSize: 12 }}>|</span>
        <span style={{
          background: '#0f172a', color: '#22d3ee',
          fontSize: 9, fontWeight: 700, padding: '2px 8px',
          borderRadius: 3, border: '1px solid #22d3ee44',
        }}>
          FRAMES
        </span>
        <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, flex: 1 }}>
          Frame Formats
        </span>
        <LanguageSelector />
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#475569' }}>
          Loading frame formats…
        </div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
          {error}
        </div>
      ) : (
        <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
          {/* Controls */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
            padding: 16,
            background: '#0a0f1a',
            border: '1px solid #1e293b',
            borderRadius: 8,
            marginBottom: 16,
          }}>
            <Field label="Frame">
              <select
                value={selectedFrameId || ''}
                onChange={(e) => setSelectedFrameId(e.target.value)}
                style={{
                  background: '#0f172a', color: '#e2e8f0',
                  border: '1px solid #334155', borderRadius: 4,
                  padding: '6px 8px', fontSize: 12,
                }}
              >
                {frames.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Link Variant">
              <select
                value={variantId || ''}
                onChange={(e) => setVariantId(e.target.value)}
                style={{
                  background: '#0f172a', color: '#e2e8f0',
                  border: '1px solid #334155', borderRadius: 4,
                  padding: '6px 8px', fontSize: 12,
                }}
              >
                {(selectedFrame?.link_variants || []).map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.lane_options ? '' : ` — ${v.encoding}${v.fec ? ` + ${v.fec}` : ''}`}
                  </option>
                ))}
              </select>
            </Field>

            {selectedVariant?.lane_options?.length > 0 && (
              <Field label="Lane Config">
                <select
                  value={laneOptionId || ''}
                  onChange={(e) => setLaneOptionId(e.target.value)}
                  style={{
                    background: '#0f172a', color: '#e2e8f0',
                    border: '1px solid #334155', borderRadius: 4,
                    padding: '6px 8px', fontSize: 12,
                  }}
                >
                  {selectedVariant.lane_options.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.label || o.id}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {!isControlFrame && (
              <Field label={`Payload / Frame (${payloadBytes.toLocaleString()} B)`}>
                <input
                  type="range"
                  min={payloadMin}
                  max={payloadMax}
                  value={Math.min(payloadBytes, payloadMax)}
                  onChange={(e) => setPayloadBytes(Number(e.target.value))}
                  style={{ accentColor: '#22d3ee' }}
                />
                <span style={{ color: '#475569', fontSize: 9, fontFamily: 'monospace' }}>
                  {payloadMin} … {payloadMax}
                </span>
              </Field>
            )}

            {!isControlFrame && (
              <Field label={`Message size (${formatBytes(messageBytes)})`}>
                <input
                  type="range"
                  min={1}
                  max={28} // 2^28 ≈ 256 MB
                  value={Math.log2(Math.max(messageBytes, 1))}
                  onChange={(e) => setMessageBytes(Math.round(2 ** Number(e.target.value)))}
                  style={{ accentColor: '#22d3ee' }}
                />
                <span style={{ color: '#475569', fontSize: 9, fontFamily: 'monospace' }}>
                  log₂ slider · 1 B … 256 MB
                </span>
              </Field>
            )}

            {isControlFrame && (
              <Field label="Frame Kind">
                <div style={{
                  padding: '6px 10px',
                  background: '#1c1917', color: '#f59e0b',
                  border: '1px solid #f59e0b44',
                  borderRadius: 4, fontSize: 11, fontWeight: 700,
                  fontFamily: 'monospace',
                }}>
                  Fixed-size control frame
                </div>
                <span style={{ color: '#475569', fontSize: 9 }}>
                  No variable payload. Sliders & presets hidden.
                </span>
              </Field>
            )}

            <Field label="View options">
              <Toggle on={endianLE} onChange={setEndianLE} label="Host (LE) byte order" />
              <Toggle on={wireTime} onChange={setWireTime} label="Show wire time" />
            </Field>
          </div>

          {/* Presets */}
          {!isControlFrame && visiblePresets.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
          }}>
            <span style={{
              color: '#64748b', fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              alignSelf: 'center', marginInlineEnd: 4,
            }}>
              Presets:
            </span>
            {visiblePresets.map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                style={{
                  background: '#0f172a', color: '#cbd5e1',
                  border: '1px solid #334155', borderRadius: 4,
                  padding: '5px 10px', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#22d3ee'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#334155'}
              >
                {p.label}
              </button>
            ))}
          </div>
          )}

          {/* Frame info */}
          {selectedFrame && (
            <div style={{
              padding: '8px 14px', marginBottom: 12,
              background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 6,
              fontSize: 11, color: '#94a3b8', lineHeight: 1.6,
            }}>
              <span style={{ color: '#e2e8f0', fontWeight: 700 }}>
                {selectedFrame.name}
              </span>
              {' '}
              <span style={{
                background: '#1e293b', color: '#22d3ee',
                fontSize: 9, fontWeight: 700, padding: '1px 6px',
                borderRadius: 3, marginInlineStart: 6,
              }}>
                {selectedFrame.osi_layer}
              </span>
              <span style={{ color: '#475569', marginInlineStart: 8 }}>·</span>
              <span style={{ marginInlineStart: 8 }}>
                {selectedFrame.summary}
              </span>
            </div>
          )}

          {/* PHY summary (post-FEC, modulation, lanes) */}
          {effectiveVariant && (
            <div style={{
              padding: '8px 14px', marginBottom: 12,
              background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 6,
              fontSize: 11, color: '#94a3b8',
              display: 'flex', gap: 20, flexWrap: 'wrap',
            }}>
              <span><strong style={{ color: '#e2e8f0' }}>{selectedVariant.name}</strong>{selectedLaneOption ? ` · ${selectedLaneOption.label || selectedLaneOption.id}` : ''}</span>
              <span>Modulation: <span style={{ color: '#a78bfa' }}>{(effectiveVariant.encoding || '').toLowerCase().includes('pam4') ? 'PAM-4 (2 bits/symbol)' : 'NRZ (1 bit/symbol)'}</span></span>
              <span>Lanes: <span style={{ color: '#22d3ee' }}>{variantLanes(effectiveVariant)} × {effectiveVariant.line_rate_gbaud} GBd</span></span>
              <span>Encoding: <span style={{ color: '#f59e0b' }}>{effectiveVariant.encoding}</span> ({(effectiveVariant.encoding_ratio * 100).toFixed(2)}%)</span>
              {effectiveVariant.fec && (
                <span>FEC: <span style={{ color: '#ec4899' }}>{effectiveVariant.fec}</span> ({(effectiveVariant.fec_ratio * 100).toFixed(2)}%)</span>
              )}
              <span>Post-FEC rate: <span style={{ color: '#10b981' }}>{effectiveUserRateGbps(effectiveVariant).toFixed(2)} Gbps</span></span>
              {effectiveVariant.spec && (
                <span style={{ color: '#475569' }}>per {effectiveVariant.spec}</span>
              )}
            </div>
          )}

          {/* Overhead waterfall */}
          <div style={{ marginBottom: 16 }}>
            <OverheadWaterfall result={overhead} variant={effectiveVariant} />
          </div>

          {/* Diagram */}
          <div style={{
            padding: 16,
            background: '#0a0f1a',
            border: '1px solid #1e293b',
            borderRadius: 8,
            marginBottom: 16,
            display: 'flex', justifyContent: 'center',
          }}>
            {selectedFrame && (
              <FrameDiagram
                frame={selectedFrame}
                variant={effectiveVariant}
                payloadBytes={payloadBytes}
                endianLE={endianLE}
                wireTime={wireTime}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
