/* global __APP_VERSION__ */
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePcap } from '../../pcap/pcapReader';
import { parseTsharkJson } from '../../pcap/tsharkReader';
import { dissectPacket } from '../../pcap/dissect';
import { evaluateRules } from '../../pcap/ruleEngine';
import { filterConversation, packetsToScenario } from '../../pcap/pcapToScenario';
import useViewerStore from '../../store/viewerStore';
import FindingsPanel from './FindingsPanel';
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

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      let dissected;
      const buffer = await file.arrayBuffer();
      const format = detectFormat(new Uint8Array(buffer));

      if (format === 'pcap' || format === 'pcapng') {
        const { packets: rawPackets } = parsePcap(buffer);
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

      const results = await loadAndEvaluateRules(dissected);
      setFindings(results);
    } catch (err) {
      setError(err.message);
      setPackets(null);
      setFindings(null);
    } finally {
      setLoading(false);
    }
  }, [loadAndEvaluateRules]);

  const reset = useCallback(() => {
    setPackets(null);
    setFindings(null);
    setError(null);
    setFileName('');
    setInputFormat('');
    setSelectedPacketIndex(null);
    setShowChat(false);
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
              {fileName} — {packets.length} packets
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
              onClick={reset}
              style={{
                background: 'none', border: '1px solid #334155', color: '#64748b',
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
              }}
            >
              New File
            </button>
          </div>

          {/* Top: packet list + findings | Bottom: chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Packet list + findings row */}
            <div style={{ flex: showChat ? '1 1 55%' : '1 1 100%', display: 'flex', overflow: 'hidden', minHeight: 0 }}>
              <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #1e293b' }}>
                <PacketList
                  packets={packets}
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
                <TraceChatPanel packets={packets} findings={findings} selectedPacketIndex={selectedPacketIndex} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
