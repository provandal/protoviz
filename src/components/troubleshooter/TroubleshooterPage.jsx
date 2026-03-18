/* global __APP_VERSION__ */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePcap } from '../../pcap/pcapReader';
import { parseTsharkJson } from '../../pcap/tsharkReader';
import { dissectPacket } from '../../pcap/dissect';
import { evaluateRules } from '../../pcap/ruleEngine';
import { filterConversation, packetsToScenario } from '../../pcap/pcapToScenario';
import { generateScenario, scenarioToYaml, suggestTitle } from '../../pcap/scenarioGenerator';
import { normalizeScenario } from '../../utils/normalizeScenario';
import useViewerStore from '../../store/viewerStore';
import { groupFlows, filterPacketsByFlows } from '../../pcap/flowGrouper';
import FindingsPanel from './FindingsPanel';
import FlowPicker from './FlowPicker';
import PacketList from './PacketList';
import TraceChatPanel from './TraceChatPanel';

/**
 * Detect file format from raw bytes, not file extension.
 * Returns 'pcap', 'pcapng', or 'json'.
 */
function detectFormat(bytes) {
  if (bytes.length < 4) return 'json';

  // PCAP LE: 0xd4c3b2a1
  if (bytes[0] === 0xd4 && bytes[1] === 0xc3 && bytes[2] === 0xb2 && bytes[3] === 0xa1) return 'pcap';
  // PCAP BE: 0xa1b2c3d4
  if (bytes[0] === 0xa1 && bytes[1] === 0xb2 && bytes[2] === 0xc3 && bytes[3] === 0xd4) return 'pcap';
  // pcapng SHB: 0x0a0d0d0a
  if (bytes[0] === 0x0a && bytes[1] === 0x0d && bytes[2] === 0x0d && bytes[3] === 0x0a) return 'pcapng';

  // Everything else: treat as JSON/text
  return 'json';
}

/**
 * Decode buffer as text, handling UTF-16 BOM that PowerShell's > redirect produces.
 */
function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);

  // Detect UTF-16 LE BOM (0xFF 0xFE)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  // Detect UTF-16 BE BOM (0xFE 0xFF)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer);
  }
  // Default UTF-8
  return new TextDecoder('utf-8').decode(buffer);
}

export default function TroubleshooterPage() {
  const navigate = useNavigate();
  const [packets, setPackets] = useState(null);
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [inputFormat, setInputFormat] = useState('');
  const [selectedPacketIndex, setSelectedPacketIndex] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genTitle, setGenTitle] = useState('');
  const [genScrub, setGenScrub] = useState(true);
  const [genIncludePayloads, setGenIncludePayloads] = useState(false);
  const [genResult, setGenResult] = useState(null); // { scenario, warnings }
  const [flowResult, setFlowResult] = useState(null);     // from groupFlows()
  const [showFlowPicker, setShowFlowPicker] = useState(false);
  const [selectedFlowIds, setSelectedFlowIds] = useState(null); // string[] | null
  const fileRef = useRef(null);

  const loadAndEvaluateRules = useCallback(async (dissected) => {
    const base = import.meta.env.BASE_URL;
    const rulesRes = await fetch(`${base}rules/roce-v2.json`);
    if (rulesRes.ok) {
      const rulesData = await rulesRes.json();
      return evaluateRules(rulesData.rules, dissected);
    }
    return [];
  }, []);

  // Compute findings for a given set of packets
  const computeFindings = useCallback(async (pkts) => {
    const results = await loadAndEvaluateRules(pkts);
    const sensitiveFindings = [];
    for (const pkt of pkts) {
      for (const layer of pkt.layers) {
        if (layer._sensitive) {
          sensitiveFindings.push({
            severity: 'warning',
            packetIndex: pkt.index,
            rule: 'sensitive_data',
            description: `Payload may contain sensitive data: ${layer._sensitive.map(m => m.name).join(', ')}`,
          });
        }
      }
    }
    return [...results, ...sensitiveFindings].sort((a, b) => a.packetIndex - b.packetIndex);
  }, [loadAndEvaluateRules]);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);
    setFindings(null);

    try {
      let dissected;
      const buffer = await file.arrayBuffer();
      const format = detectFormat(new Uint8Array(buffer));

      if (format === 'pcap' || format === 'pcapng') {
        const { packets: rawPackets } = parsePcap(buffer, 50000);
        dissected = rawPackets.map(pkt => ({
          ...pkt,
          ...dissectPacket(pkt),
        }));
        setInputFormat(format === 'pcapng' ? 'pcapng' : 'PCAP');
      } else {
        // Text/JSON — decode handling UTF-16 BOM
        const text = decodeText(buffer);
        const { packets: parsed } = parseTsharkJson(text);
        dissected = parsed;
        setInputFormat('tshark JSON');
      }

      setPackets(dissected);
      setSelectedPacketIndex(null);

      // Flow grouping — detect conversations in the capture
      try {
        const flowRes = groupFlows(dissected);
        setFlowResult(flowRes);
        if (flowRes.flows.length > 1) {
          setShowFlowPicker(true);
          setSelectedFlowIds(null);
          // Don't compute findings yet — wait for flow selection
        } else if (flowRes.flows.length === 1) {
          setShowFlowPicker(false);
          setSelectedFlowIds([flowRes.flows[0].id]);
          const filtered = filterPacketsByFlows(dissected, [flowRes.flows[0].id], flowRes.packetFlowMap);
          setFindings(await computeFindings(filtered));
        } else {
          setShowFlowPicker(false);
          setSelectedFlowIds(null);
          setFindings(await computeFindings(dissected));
        }
      } catch (_flowErr) {
        setFlowResult(null);
        setShowFlowPicker(false);
        setSelectedFlowIds(null);
        setFindings(await computeFindings(dissected));
      }
    } catch (err) {
      setError(err.message);
      setPackets(null);
      setFindings(null);
    } finally {
      setLoading(false);
    }
  }, [loadAndEvaluateRules, computeFindings]);

  const reset = useCallback(() => {
    setPackets(null);
    setFindings(null);
    setError(null);
    setFileName('');
    setInputFormat('');
    setSelectedPacketIndex(null);
    setShowChat(false);
    setFlowResult(null);
    setShowFlowPicker(false);
    setSelectedFlowIds(null);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const handleFindingClick = useCallback((packetIndex) => {
    setSelectedPacketIndex(packetIndex);
  }, []);

  const handleConversationView = useCallback((endpointA, endpointB) => {
    if (!packets) return;
    const convPackets = filterConversation(packets, endpointA, endpointB);
    if (convPackets.length === 0) return;

    const scenario = packetsToScenario(convPackets, endpointA, endpointB);
    const slug = '_pcap_conversation';
    useViewerStore.setState({ scenario, currentSlug: slug, step: 0, playing: false, error: null, loading: false });
    navigate(`/${slug}`);
  }, [packets, navigate]);

  // Packets filtered by selected flows — used for display and scenario generation
  const displayPackets = useMemo(() => {
    if (!packets) return [];
    if (selectedFlowIds && flowResult?.packetFlowMap) {
      return filterPacketsByFlows(packets, selectedFlowIds, flowResult.packetFlowMap);
    }
    return packets;
  }, [packets, selectedFlowIds, flowResult]);

  const getEffectivePackets = useCallback(() => {
    return displayPackets.length > 0 ? displayPackets : null;
  }, [displayPackets]);

  const openGenModal = useCallback(() => {
    const effectivePackets = getEffectivePackets();
    if (!effectivePackets) return;
    setGenTitle(suggestTitle(effectivePackets));
    setGenScrub(true);
    setGenIncludePayloads(false);
    setGenResult(null);
    setShowGenModal(true);
  }, [getEffectivePackets]);

  const handleGenerate = useCallback(() => {
    const effectivePackets = getEffectivePackets();
    if (!effectivePackets) return;
    const result = generateScenario(effectivePackets, {
      title: genTitle,
      scrub: genScrub,
      includePayloads: genIncludePayloads,
    });
    setGenResult(result);
  }, [getEffectivePackets, genTitle, genScrub, genIncludePayloads]);

  const handlePreview = useCallback(() => {
    if (!genResult) return;
    try {
      const normalized = normalizeScenario(genResult.scenario);
      const slug = '_pcap_generated';
      useViewerStore.setState({ scenario: normalized, currentSlug: slug, step: 0, playing: false, error: null, loading: false });
      setShowGenModal(false);
      navigate(`/${slug}`);
    } catch (err) {
      setGenResult(prev => ({
        ...prev,
        warnings: [...(prev?.warnings || []), `Preview error: ${err.message}`],
      }));
    }
  }, [genResult, navigate]);

  const handleDownloadYaml = useCallback(() => {
    if (!genResult) return;
    const yamlStr = scenarioToYaml(genResult.scenario);
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (genResult.scenario.meta?.title || 'scenario')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
    a.download = `${safeName}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [genResult]);

  const handleFlowConfirm = useCallback(async (flowIds) => {
    setSelectedFlowIds(flowIds);
    setShowFlowPicker(false);
    // Recompute findings for selected flows only
    if (packets && flowResult?.packetFlowMap) {
      const filtered = filterPacketsByFlows(packets, flowIds, flowResult.packetFlowMap);
      setFindings(await computeFindings(filtered));
    }
  }, [packets, flowResult, computeFindings]);

  const handleFlowCancel = useCallback(() => {
    setShowFlowPicker(false);
  }, []);

  return (
    <div style={{
      minHeight: '100vh', background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div
          onClick={() => navigate('/')}
          style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
        >
          <span style={{ color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: '0.05em' }}>
            PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
          </span>
        </div>
        <span style={{ color: '#334155', fontSize: 12 }}>|</span>
        <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>PCAP Troubleshooter</span>
      </div>

      {/* Upload area or results */}
      {!packets ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ textAlign: 'center', maxWidth: 560 }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📡</div>
            <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              PCAP Troubleshooter
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 24, lineHeight: 1.6 }}>
              Upload a PCAP file or tshark JSON export to analyze protocol compliance.
              All parsing happens locally in your browser — nothing is uploaded to any server.
            </div>

            <label
              style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg, #1e40af, #7c3aed)',
                color: '#fff', padding: '10px 24px', borderRadius: 6,
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 13, fontWeight: 600,
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Parsing...' : 'Choose File'}
              <input
                ref={fileRef}
                type="file"
                accept=".pcap,.pcapng,.cap,.json,.out,.txt,*/*"
                onChange={handleFile}
                style={{ display: 'none' }}
              />
            </label>

            {error && (
              <div style={{
                marginTop: 16, padding: '10px 16px',
                background: '#450a0a', border: '1px solid #dc2626', borderRadius: 6,
                color: '#fca5a5', fontSize: 11,
              }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 32, textAlign: 'left' }}>
              <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                Supported formats
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>PCAP / pcapng</div>
                  <div style={{ color: '#475569', fontSize: 10, lineHeight: 1.5 }}>
                    Standard packet capture (.pcap, .pcapng, .cap). Built-in dissectors for Ethernet, IPv4, TCP, UDP, and RoCEv2.
                  </div>
                </div>
                <div style={{ flex: 1, background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ color: '#a78bfa', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>tshark JSON (.json)</div>
                  <div style={{ color: '#475569', fontSize: 10, lineHeight: 1.5 }}>
                    Full protocol dissection via Wireshark. Supports 3000+ protocols.
                  </div>
                  <div style={{ color: '#334155', fontSize: 9, marginTop: 4, fontFamily: 'monospace' }}>
                    tshark -r capture.pcap -T json &gt; out.json
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Results toolbar */}
          <div style={{
            padding: '8px 16px', background: '#0f172a', borderBottom: '1px solid #1e293b',
            display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          }}>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>
              {fileName} — {displayPackets.length} packets{selectedFlowIds && packets.length !== displayPackets.length ? ` (of ${packets.length} total)` : ''}
            </span>
            {inputFormat && (
              <span style={{
                background: '#0c1929', color: '#93c5fd',
                fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
              }}>
                {inputFormat}
              </span>
            )}
            {findings && (
              <span style={{
                background: findings.some(f => f.severity === 'error') ? '#450a0a' : '#052e16',
                color: findings.some(f => f.severity === 'error') ? '#fca5a5' : '#4ade80',
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
              }}>
                {findings.length} finding{findings.length !== 1 ? 's' : ''}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {flowResult && flowResult.flows.length > 1 && (
              <button
                onClick={() => setShowFlowPicker(true)}
                style={{
                  background: selectedFlowIds ? '#0c1929' : 'none',
                  border: '1px solid #334155',
                  color: selectedFlowIds ? '#93c5fd' : '#64748b',
                  padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                  fontWeight: selectedFlowIds ? 600 : 400,
                }}
              >
                Filter Flows{selectedFlowIds ? ` (${selectedFlowIds.length})` : ''}
              </button>
            )}
            <button
              onClick={() => setShowChat(c => !c)}
              style={{
                background: showChat ? '#1e40af' : 'none',
                border: '1px solid #334155', color: showChat ? '#fff' : '#64748b',
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
              }}
            >
              Chat
            </button>
            <button
              onClick={openGenModal}
              style={{
                background: 'none', border: '1px solid #334155', color: '#64748b',
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
              }}
            >
              Generate Scenario
            </button>
            <button
              onClick={reset}
              style={{
                background: 'none', border: '1px solid #334155', color: '#64748b',
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
              }}
            >
              New File
            </button>
          </div>

          {/* Sensitive data warning banner */}
          {findings && findings.some(f => f.rule === 'sensitive_data') && (
            <div style={{
              padding: '6px 16px', background: '#78350f', borderBottom: '1px solid #92400e',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
              fontSize: 11, color: '#fde68a',
            }}>
              <span style={{ fontWeight: 700 }}>Sensitive data detected</span>
              <span style={{ color: '#fbbf24' }}>
                — Payload bytes containing potential credentials or PII were found. Raw payload content is automatically excluded from AI chat context.
              </span>
            </div>
          )}

          {/* Flow picker overlay (shown instead of packet list) */}
          {showFlowPicker && flowResult ? (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <FlowPicker
                flows={flowResult.flows}
                onConfirm={handleFlowConfirm}
                onCancel={handleFlowCancel}
              />
            </div>
          ) : (
            <>
              {/* Top: packet list + findings | Bottom: chat */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Packet list + findings row */}
                <div style={{ flex: showChat ? '1 1 55%' : '1 1 100%', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
                  <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #1e293b' }}>
                    <PacketList
                      packets={displayPackets}
                      findings={findings}
                      selectedIndex={selectedPacketIndex}
                      onPacketSelect={setSelectedPacketIndex}
                      onConversationView={handleConversationView}
                    />
                  </div>
                  {findings && findings.length > 0 && (
                    <div style={{ width: 360, overflowY: 'auto', flexShrink: 0 }}>
                      <FindingsPanel findings={findings} onFindingClick={handleFindingClick} />
                    </div>
                  )}
                </div>
                {/* Chat pane below */}
                {showChat && (
                  <div style={{ flex: '1 1 45%', borderTop: '1px solid #1e293b', minHeight: 0, overflow: 'hidden' }}>
                    <TraceChatPanel packets={displayPackets} findings={findings} selectedPacketIndex={selectedPacketIndex} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Generate Scenario Modal */}
      {showGenModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowGenModal(false); }}
        >
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
            padding: 24, width: 460, maxHeight: '80vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
              Generate Scenario
            </div>

            {!genResult ? (
              <>
                {/* Title */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 600, marginBottom: 4 }}>
                    Title
                  </label>
                  <input
                    type="text"
                    value={genTitle}
                    onChange={(e) => setGenTitle(e.target.value)}
                    style={{
                      width: '100%', background: '#020817', border: '1px solid #334155',
                      color: '#e2e8f0', borderRadius: 4, padding: '6px 8px', fontSize: 12,
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Scrub toggle */}
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="gen-scrub"
                    checked={genScrub}
                    onChange={(e) => setGenScrub(e.target.checked)}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <label htmlFor="gen-scrub" style={{ color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                    Scrub sensitive data (replace real IPs and MACs)
                  </label>
                </div>

                {/* Include payloads toggle */}
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    id="gen-payloads"
                    checked={genIncludePayloads}
                    onChange={(e) => setGenIncludePayloads(e.target.checked)}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <label htmlFor="gen-payloads" style={{ color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                    Include payload bytes
                  </label>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowGenModal(false)}
                    style={{
                      background: 'none', border: '1px solid #334155', color: '#64748b',
                      padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerate}
                    style={{
                      background: 'linear-gradient(135deg, #1e40af, #7c3aed)',
                      border: 'none', color: '#fff',
                      padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    Generate
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Warnings */}
                {genResult.warnings.length > 0 && (
                  <div style={{
                    marginBottom: 12, padding: '8px 12px',
                    background: '#1c1917', border: '1px solid #78350f', borderRadius: 4,
                  }}>
                    {genResult.warnings.map((w, i) => (
                      <div key={i} style={{ color: '#fde68a', fontSize: 10, lineHeight: 1.6 }}>
                        {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Success info */}
                <div style={{
                  marginBottom: 16, padding: '10px 12px',
                  background: '#052e16', border: '1px solid #166534', borderRadius: 4,
                }}>
                  <div style={{ color: '#4ade80', fontSize: 11, fontWeight: 600 }}>
                    Scenario generated successfully
                  </div>
                  <div style={{ color: '#86efac', fontSize: 10, marginTop: 4 }}>
                    {genResult.scenario.meta.title}
                  </div>
                  <div style={{ color: '#4ade80', fontSize: 10, marginTop: 2 }}>
                    {genResult.scenario.frames?.length || 0} frames, {genResult.scenario.timeline?.length || 0} timeline events, {genResult.scenario.topology?.actors?.length || 0} actors
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setGenResult(null); }}
                    style={{
                      background: 'none', border: '1px solid #334155', color: '#64748b',
                      padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleDownloadYaml}
                    style={{
                      background: 'none', border: '1px solid #334155', color: '#93c5fd',
                      padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    Download YAML
                  </button>
                  <button
                    onClick={handlePreview}
                    style={{
                      background: 'linear-gradient(135deg, #1e40af, #7c3aed)',
                      border: 'none', color: '#fff',
                      padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    Preview
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
