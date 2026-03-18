import { useState, useRef, useEffect, useCallback } from 'react';
import { PAYLOAD_FIELD_KEYS } from '../../utils/sensitiveDataDetector';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
];

function buildTraceSummary(packets, findings, selectedPacketIndex) {
  const lines = [];
  lines.push(`PCAP trace: ${packets.length} packets`);

  // Protocol breakdown
  const protocols = {};
  for (const pkt of packets) {
    const topLayer = pkt.layers[pkt.layers.length - 1]?.name || 'Unknown';
    protocols[topLayer] = (protocols[topLayer] || 0) + 1;
  }
  lines.push(`Protocols: ${Object.entries(protocols).map(([k, v]) => `${k}(${v})`).join(', ')}`);

  // IP endpoints
  const endpoints = new Set();
  for (const pkt of packets) {
    const ip = pkt.layers.find(l => l.name === 'IPv4');
    if (ip) {
      endpoints.add(ip.fields.src_ip);
      endpoints.add(ip.fields.dst_ip);
    }
  }
  if (endpoints.size > 0) lines.push(`Endpoints: ${[...endpoints].join(', ')}`);

  // TCP flags summary
  const tcpFlags = {};
  for (const pkt of packets) {
    const tcp = pkt.layers.find(l => l.name === 'TCP');
    if (tcp) {
      for (const flag of (tcp.fields.flag_names || '').split(',').filter(Boolean)) {
        tcpFlags[flag] = (tcpFlags[flag] || 0) + 1;
      }
    }
  }
  if (Object.keys(tcpFlags).length > 0) {
    lines.push(`TCP flags: ${Object.entries(tcpFlags).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }

  // RoCE QP summary
  const qps = new Set();
  for (const pkt of packets) {
    const bth = pkt.layers.find(l => l.name.includes('BTH'));
    if (bth) qps.add(bth.fields.dest_qp);
  }
  if (qps.size > 0) lines.push(`RoCE QPs: ${[...qps].join(', ')}`);

  // Findings
  if (findings && findings.length > 0) {
    lines.push(`\nFindings (${findings.length}):`);
    for (const f of findings) {
      lines.push(`  [${f.severity.toUpperCase()}] Pkt #${f.packetIndex + 1}: ${f.description}${f.spec_ref ? ` (${f.spec_ref})` : ''}`);
    }
  }

  // Selected packet detail — strip raw payload bytes before sending to API
  if (selectedPacketIndex != null && packets[selectedPacketIndex]) {
    const pkt = packets[selectedPacketIndex];
    lines.push(`\nUser is looking at packet #${selectedPacketIndex + 1}:`);
    lines.push(`  Summary: ${pkt.summary}`);
    for (const layer of pkt.layers) {
      // Remove hex_dump, ascii, and other raw payload fields from API context
      const sanitizedFields = {};
      for (const [k, v] of Object.entries(layer.fields)) {
        if (!PAYLOAD_FIELD_KEYS.has(k)) {
          sanitizedFields[k] = v;
        }
      }
      lines.push(`  L${layer.layer} ${layer.name}: ${JSON.stringify(sanitizedFields)}`);
      if (layer._sensitive) {
        lines.push(`  ⚠ Sensitive data detected: ${layer._sensitive.map(m => m.name).join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

function buildSystemPrompt(packets, findings, selectedPacketIndex) {
  const summary = buildTraceSummary(packets, findings, selectedPacketIndex);

  return `You are a network protocol troubleshooting expert embedded in ProtoViz's PCAP Troubleshooter.

The user has uploaded a PCAP trace for analysis. Here is the trace summary:

${summary}

Help the user understand what is happening in their trace. Focus on:
- Identifying the root cause of any issues (TCP RSTs, PSN gaps, missing ACKs, etc.)
- Explaining the protocol behavior observed
- Suggesting what to investigate next
- Referencing relevant RFCs or IB specs when applicable

Be concise but thorough. If the user asks about a specific packet, explain its role in the overall exchange.`;
}

export default function TraceChatPanel({ packets, findings, selectedPacketIndex }) {
  const [messages, setMessages] = useState([]);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('protoviz_api_key') || '');
  const [model, setModel] = useState(() => localStorage.getItem('protoviz_chat_model') || 'claude-sonnet-4-6');
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const saveApiKey = useCallback((key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('protoviz_api_key', trimmed);
    setShowSettings(false);
    setKeyInput('');
  }, []);

  const saveModel = useCallback((m) => {
    setModel(m);
    localStorage.setItem('protoviz_chat_model', m);
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || !apiKey) return;

    const userMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setStreaming(true);

    try {
      abortRef.current = new AbortController();
      const systemPrompt = buildSystemPrompt(packets, findings, selectedPacketIndex);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: newMessages,
          stream: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.text) {
                accumulated += data.delta.text;
                setMessages([...newMessages, { role: 'assistant', content: accumulated }]);
              }
            } catch {
              // Skip non-JSON lines
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setMessages(prev => {
          if (prev.length > 0 && prev[prev.length - 1]?.content === '') {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, apiKey, packets, findings, selectedPacketIndex, messages, model]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const needsApiKey = !apiKey;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0f1a',
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 800 }}>TRACE CHAT</span>
          <select
            value={model}
            onChange={e => saveModel(e.target.value)}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              fontSize: 10, borderRadius: 3, padding: '2px 4px', cursor: 'pointer',
            }}
          >
            {MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setShowSettings(s => !s)}
            style={{ background: 'none', border: '1px solid #334155', color: '#64748b', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}
          >
            {apiKey ? '🔑' : 'Key'}
          </button>
          <button
            onClick={() => { setMessages([]); setError(null); }}
            style={{ background: 'none', border: '1px solid #334155', color: '#64748b', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Settings */}
      {(showSettings || needsApiKey) && (
        <div style={{ padding: 12, background: '#0f172a', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6 }}>
            Anthropic API Key {apiKey ? '(set)' : '(required)'}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey(keyInput)}
              style={{
                flex: 1, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                fontSize: 11, padding: '4px 8px', borderRadius: 4, outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => saveApiKey(keyInput)}
              style={{
                background: '#1e40af', border: 'none', color: '#fff',
                fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
          <div style={{ color: '#475569', fontSize: 9, marginTop: 4 }}>
            Stored in localStorage. Sent only to api.anthropic.com.
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {messages.length === 0 && !needsApiKey && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ color: '#475569', fontSize: 11, marginBottom: 8 }}>
              Ask about your trace — protocol issues, packet behavior, troubleshooting advice.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                'What went wrong in this trace?',
                'Why is there a TCP RST?',
                'Explain the RoCE PSN gap',
                'What should I check next?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  style={{
                    background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
                    fontSize: 10, padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              marginBottom: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '90%',
              padding: '8px 10px',
              borderRadius: 8,
              background: msg.role === 'user' ? '#1e40af' : '#1e293b',
              color: msg.role === 'user' ? '#e2e8f0' : '#cbd5e1',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content || (streaming && i === messages.length - 1 ? (
                <span style={{ color: '#475569' }}>Thinking...</span>
              ) : null)}
            </div>
          </div>
        ))}

        {error && (
          <div style={{
            padding: '8px 10px', background: '#450a0a', border: '1px solid #dc2626',
            borderRadius: 6, marginBottom: 8,
          }}>
            <div style={{ color: '#fca5a5', fontSize: 10 }}>{error}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: 8, borderTop: '1px solid #1e293b', background: '#0f172a',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={needsApiKey ? 'Set API key above...' : 'Ask about this trace...'}
            disabled={needsApiKey || streaming}
            rows={2}
            style={{
              flex: 1, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
              fontSize: 12, padding: '8px 10px', borderRadius: 6, outline: 'none',
              resize: 'none', fontFamily: "'IBM Plex Sans',system-ui,sans-serif",
              lineHeight: 1.4,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              onClick={streaming ? stopStreaming : sendMessage}
              disabled={needsApiKey || (!streaming && !input.trim())}
              style={{
                background: streaming ? '#991b1b' : '#1e40af',
                border: 'none', color: '#fff',
                fontSize: 11, padding: '0 12px', borderRadius: 6,
                cursor: needsApiKey ? 'not-allowed' : 'pointer',
                opacity: (needsApiKey || (!streaming && !input.trim())) ? 0.4 : 1,
                flex: 1,
              }}
            >
              {streaming ? 'Stop' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
