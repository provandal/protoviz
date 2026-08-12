import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PAYLOAD_FIELD_KEYS, redactSensitiveString } from '../../utils/sensitiveDataDetector';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
];

// Full layer detail is sent for this many packets of the selected exchanges;
// packets beyond it get one summary line each, up to SUMMARY_PACKET_CAP.
const DETAIL_PACKET_CAP = 400;
const SUMMARY_PACKET_CAP = 2000;
// Prompts above this many input tokens require an explicit confirmation.
const WARN_INPUT_TOKENS = 20000;
// Rough chars-per-token ratio for the live local estimate (exact count comes
// from the count_tokens endpoint at send time).
const CHARS_PER_TOKEN = 3.5;

function packetDetailLines(pkt, index, t0) {
  const ts = pkt.timestamp != null && t0 != null ? ` t=+${(pkt.timestamp - t0).toFixed(6)}s` : '';
  const lines = [`Packet #${index + 1}${ts}`];
  lines.push(`  Summary: ${redactSensitiveString(pkt.summary)}`);
  for (const layer of pkt.layers) {
    // Remove hex_dump, ascii, and other raw payload fields from API context,
    // and redact credential/PII spans in the rest — protocol dissectors
    // surface payload-derived strings (request lines, cookies, names) as
    // ordinary fields that the payload-key strip doesn't cover.
    const sanitizedFields = {};
    for (const [k, v] of Object.entries(layer.fields)) {
      if (PAYLOAD_FIELD_KEYS.has(k)) continue;
      sanitizedFields[k] = typeof v === 'string' ? redactSensitiveString(v) : v;
    }
    lines.push(`  L${layer.layer} ${layer.name}: ${JSON.stringify(sanitizedFields)}`);
    if (layer._sensitive) {
      lines.push(`  ⚠ Sensitive data detected: ${layer._sensitive.map(m => m.name).join(', ')}`);
    }
  }
  return lines;
}

function buildTraceSummary(packets, findings) {
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

  // Findings — these carry original capture indexes; translate to positions
  // in the selected-exchange listing below so packet numbers agree everywhere
  // in the prompt.
  const posByOrig = new Map(packets.map((p, i) => [p.index, i]));
  if (findings && findings.length > 0) {
    lines.push(`\nFindings (${findings.length}):`);
    for (const f of findings) {
      const pos = posByOrig.get(f.packetIndex);
      lines.push(`  [${f.severity.toUpperCase()}] Pkt #${(pos ?? f.packetIndex) + 1}: ${f.description}${f.spec_ref ? ` (${f.spec_ref})` : ''}`);
    }
  }

  // Per-packet detail for every packet of the selected exchanges (bounded).
  // Raw payload bytes are stripped per packet in packetDetailLines.
  const t0 = packets[0]?.timestamp ?? null;
  const detailCount = Math.min(packets.length, DETAIL_PACKET_CAP);
  if (detailCount > 0) {
    lines.push(`\nPacket detail (${detailCount} of ${packets.length} packets in full):`);
    for (let i = 0; i < detailCount; i++) {
      lines.push(...packetDetailLines(packets[i], i, t0));
    }
  }
  if (packets.length > DETAIL_PACKET_CAP) {
    const rest = packets.slice(DETAIL_PACKET_CAP, DETAIL_PACKET_CAP + SUMMARY_PACKET_CAP);
    lines.push(`\nRemaining packets (summaries only):`);
    rest.forEach((pkt, i) => lines.push(`#${DETAIL_PACKET_CAP + i + 1} ${redactSensitiveString(pkt.summary)}`));
    const omitted = packets.length - DETAIL_PACKET_CAP - rest.length;
    if (omitted > 0) {
      lines.push(`…and ${omitted} more packets omitted. If you need them, ask the user to narrow the exchange selection.`);
    }
  }

  return lines.join('\n');
}

// Returns the system prompt as content blocks: a stable block carrying the
// full trace context (marked as a prompt-cache breakpoint, so follow-up
// questions re-read it at ~0.1x cost instead of re-billing the whole trace)
// followed by a small volatile block that changes as the user clicks packets.
function buildSystemBlocks(packets, findings, selectedPacketIndex) {
  const summary = buildTraceSummary(packets, findings);

  const stable = `You are a network protocol troubleshooting expert embedded in ProtoViz's PCAP Troubleshooter.

The user has uploaded a PCAP trace and selected the exchanges below for analysis:

${summary}

Help the user understand what is happening in their trace. Focus on:
- Identifying the root cause of any issues (TCP RSTs, PSN gaps, missing ACKs, etc.)
- Explaining the protocol behavior observed
- Suggesting what to investigate next
- Referencing relevant RFCs or IB specs when applicable

Be concise but thorough. If the user asks about a specific packet, explain its role in the overall exchange.`;

  const blocks = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];

  if (selectedPacketIndex != null && packets[selectedPacketIndex]) {
    const pkt = packets[selectedPacketIndex];
    const lines = [`The user is currently viewing packet #${selectedPacketIndex + 1}: ${redactSensitiveString(pkt.summary)}`];
    if (selectedPacketIndex >= DETAIL_PACKET_CAP) {
      // Not covered by the detailed listing above — include its full detail here
      lines.push(...packetDetailLines(pkt, selectedPacketIndex, packets[0]?.timestamp ?? null));
    }
    blocks.push({ type: 'text', text: lines.join('\n') });
  }

  return blocks;
}

export default function TraceChatPanel({ packets, findings, selectedPacketIndex }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('protoviz_api_key') || '');
  const [model, setModel] = useState(() => localStorage.getItem('protoviz_chat_model') || 'claude-sonnet-4-6');
  const [keyInput, setKeyInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [counting, setCounting] = useState(false);
  const [pendingSend, setPendingSend] = useState(null); // { messages, tokens, exact }
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  const systemBlocks = useMemo(
    () => buildSystemBlocks(packets, findings, selectedPacketIndex),
    [packets, findings, selectedPacketIndex]
  );

  // Live rough estimate of the full request size (system + history + draft).
  const estimatedTokens = useMemo(() => {
    let chars = 0;
    for (const b of systemBlocks) chars += b.text.length;
    for (const m of messages) chars += m.content.length;
    chars += input.length;
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }, [systemBlocks, messages, input]);

  // A pending confirmation is priced against a specific prompt and model —
  // drop it if either changes underneath it.
  useEffect(() => {
    setPendingSend(null);
  }, [systemBlocks, model]);

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

  const apiHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }), [apiKey]);

  const doSend = useCallback(async (newMessages) => {
    setPendingSend(null);
    setMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setStreaming(true);

    try {
      abortRef.current = new AbortController();

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemBlocks,
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
  }, [apiHeaders, model, systemBlocks]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || counting || !apiKey) return;

    const newMessages = [...messages, { role: 'user', content: input.trim() }];
    setError(null);
    setPendingSend(null);

    let chars = systemBlocks.reduce((n, b) => n + b.text.length, 0);
    for (const m of newMessages) chars += m.content.length;
    const localEstimate = Math.ceil(chars / CHARS_PER_TOKEN);

    // Exact count from the (free) count_tokens endpoint — but only when the
    // local estimate is close enough to the warning threshold to matter;
    // below that, skip the extra round trip (it re-uploads the whole prompt).
    let tokens = null;
    let exact = false;
    if (localEstimate >= WARN_INPUT_TOKENS / 2) {
      setCounting(true);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
          method: 'POST',
          headers: apiHeaders,
          body: JSON.stringify({ model, system: systemBlocks, messages: newMessages }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (typeof data.input_tokens === 'number') {
            tokens = data.input_tokens;
            exact = true;
          }
        } else if (resp.status === 401 || resp.status === 403) {
          // Auth problems would otherwise hide behind the fallback estimate
          // until after the user confirms the token warning — surface now.
          const errText = await resp.text();
          setError(`API ${resp.status}: ${errText.slice(0, 200)}`);
          return;
        }
        // Other statuses (429, 5xx): fall through to the local estimate.
      } catch {
        // Network error or timeout — fall back to the local estimate.
      } finally {
        setCounting(false);
      }
    }

    if (tokens == null) {
      tokens = localEstimate;
    }

    if (tokens > WARN_INPUT_TOKENS) {
      setPendingSend({ messages: newMessages, tokens, exact });
      return;
    }

    await doSend(newMessages);
  }, [input, streaming, counting, apiKey, messages, model, systemBlocks, apiHeaders, doSend]);

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
          <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 800 }}>{t('traceChat.title')}</span>
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
            {apiKey ? '🔑' : t('traceChat.key')}
          </button>
          <button
            onClick={() => { setMessages([]); setError(null); }}
            style={{ background: 'none', border: '1px solid #334155', color: '#64748b', padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}
          >
            {t('traceChat.clear')}
          </button>
        </div>
      </div>

      {/* Settings */}
      {(showSettings || needsApiKey) && (
        <div style={{ padding: 12, background: '#0f172a', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6 }}>
            {t('traceChat.apiKeyLabel')} {apiKey ? t('traceChat.apiKeySet') : t('traceChat.apiKeyRequired')}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="password"
              placeholder={t('traceChat.apiKeyPlaceholder')}
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
              {t('traceChat.save')}
            </button>
          </div>
          <div style={{ color: '#475569', fontSize: 9, marginTop: 4 }}>
            {t('traceChat.apiKeyStorage')}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {messages.length === 0 && !needsApiKey && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ color: '#475569', fontSize: 11, marginBottom: 8 }}>
              {t('traceChat.emptyHint')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                t('traceChat.suggestWrong'),
                t('traceChat.suggestRst'),
                t('traceChat.suggestPsn'),
                t('traceChat.suggestNext'),
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
                <span style={{ color: '#475569' }}>{t('traceChat.thinking')}</span>
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
        {pendingSend && (
          <div style={{
            padding: '8px 10px', background: '#451a03', border: '1px solid #d97706',
            borderRadius: 6, marginBottom: 8,
          }}>
            <div style={{ color: '#fcd34d', fontSize: 11, marginBottom: 6 }}>
              {t(pendingSend.exact ? 'traceChat.tokenWarningExact' : 'traceChat.tokenWarning', {
                tokens: pendingSend.tokens.toLocaleString(),
              })}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => doSend(pendingSend.messages)}
                style={{
                  background: '#b45309', border: 'none', color: '#fff',
                  fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                }}
              >
                {t('traceChat.sendAnyway')}
              </button>
              <button
                onClick={() => setPendingSend(null)}
                style={{
                  background: 'none', border: '1px solid #78716c', color: '#d6d3d1',
                  fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                }}
              >
                {t('traceChat.cancel')}
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 4 }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => { setInput(e.target.value); setPendingSend(null); }}
            onKeyDown={handleKeyDown}
            placeholder={needsApiKey ? t('traceChat.setKeyPlaceholder') : t('traceChat.inputPlaceholder')}
            disabled={needsApiKey || streaming || counting}
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
              disabled={needsApiKey || counting || (!streaming && !input.trim())}
              style={{
                background: streaming ? '#991b1b' : '#1e40af',
                border: 'none', color: '#fff',
                fontSize: 11, padding: '0 12px', borderRadius: 6,
                cursor: needsApiKey ? 'not-allowed' : 'pointer',
                opacity: (needsApiKey || counting || (!streaming && !input.trim())) ? 0.4 : 1,
                flex: 1,
              }}
            >
              {streaming ? t('traceChat.stop') : counting ? t('traceChat.counting') : t('traceChat.send')}
            </button>
          </div>
        </div>
        {packets.length > 0 && (
          <div style={{ color: '#475569', fontSize: 9, marginTop: 4, textAlign: 'right' }}>
            {t('traceChat.contextStats', {
              packets: packets.length.toLocaleString(),
              findings: (findings?.length || 0).toLocaleString(),
              tokens: estimatedTokens.toLocaleString(),
            })}
            {packets.length > DETAIL_PACKET_CAP && (
              <> · {t('traceChat.contextTruncated', { cap: DETAIL_PACKET_CAP.toLocaleString() })}</>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
