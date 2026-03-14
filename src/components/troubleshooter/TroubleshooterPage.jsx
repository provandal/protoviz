/* global __APP_VERSION__ */
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { parsePcap } from '../../pcap/pcapReader';
import { dissectPacket } from '../../pcap/dissect';
import { evaluateRules } from '../../pcap/ruleEngine';
import FindingsPanel from './FindingsPanel';
import PacketList from './PacketList';

export default function TroubleshooterPage() {
  const navigate = useNavigate();
  const [packets, setPackets] = useState(null);
  const [findings, setFindings] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const { packets: rawPackets } = parsePcap(buffer);

      // Dissect all packets
      const dissected = rawPackets.map(pkt => ({
        ...pkt,
        ...dissectPacket(pkt),
      }));

      setPackets(dissected);

      // Load and evaluate rules
      const base = import.meta.env.BASE_URL;
      const rulesRes = await fetch(`${base}rules/roce-v2.json`);
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        const results = evaluateRules(rulesData.rules, dissected);
        setFindings(results);
      }
    } catch (err) {
      setError(err.message);
      setPackets(null);
      setFindings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPackets(null);
    setFindings(null);
    setError(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
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
          <div style={{ textAlign: 'center', maxWidth: 500 }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📡</div>
            <div style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              PCAP Troubleshooter
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 24, lineHeight: 1.6 }}>
              Upload a PCAP file to analyze protocol compliance.
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
              {loading ? 'Parsing...' : 'Choose PCAP File'}
              <input
                ref={fileRef}
                type="file"
                accept=".pcap,.cap"
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

            <div style={{ marginTop: 24, color: '#334155', fontSize: 10 }}>
              Supports standard PCAP format (Ethernet link type)
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
              onClick={reset}
              style={{
                background: 'none', border: '1px solid #334155', color: '#64748b',
                padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10,
              }}
            >
              New File
            </button>
          </div>

          {/* Split: packet list + findings */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #1e293b' }}>
              <PacketList packets={packets} findings={findings} />
            </div>
            {findings && findings.length > 0 && (
              <div style={{ width: 360, overflowY: 'auto', flexShrink: 0 }}>
                <FindingsPanel findings={findings} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
