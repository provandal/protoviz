import { useState, useRef, useEffect, useCallback } from 'react';
import useViewerStore from '../../store/viewerStore';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
];

function buildSystemPrompt(scenario, step) {
  const ev = scenario.timeline[step];
  const total = scenario.timeline.length;

  let prompt = `You are a protocol expert assistant embedded in ProtoViz, an interactive protocol education platform.

Current scenario: ${scenario.meta.title}
Protocol: ${scenario.meta.protocol}
${scenario.meta.description ? `Description: ${scenario.meta.description}\n` : ''}
The user is viewing step ${step + 1} of ${total}:
Phase: ${ev.phase}
Event: ${ev.label}
${ev.detail ? `Detail: ${ev.detail}` : ''}`;

  if (ev.type === 'frame_tx' && ev.frame) {
    prompt += `\n\nCurrent frame: ${ev.frame.name} (${ev.frame.bytes} bytes)`;
    prompt += `\nHeaders: ${ev.frame.headers.map(h => `${h.name} (L${h.layer})`).join(' → ')}`;
    for (const hdr of ev.frame.headers) {
      prompt += `\n\n${hdr.name} fields:`;
      for (const f of hdr.fields) {
        prompt += `\n  ${f.abbrev}: ${f.value} — ${f.desc}`;
      }
    }
  }

  if (ev.state) {
    prompt += `\n\nState changes at this step:`;
    for (const [actorId, layers] of Object.entries(ev.state)) {
      for (const [layerNum, fields] of Object.entries(layers)) {
        prompt += `\n  ${actorId} L${layerNum}: ${JSON.stringify(fields)}`;
      }
    }
  }

  prompt += `\n\nHelp the user understand the protocol exchange. Be concise but thorough. Use technical detail appropriate for protocol education. When referencing specs, cite the document and section.`;

  return prompt;
}

export default function ChatPanel() {
  const scenario = useViewerStore(s => s.scenario);
  const step = useViewerStore(s => s.step);
  const messages = useViewerStore(s => s.chatMessages);
  const apiKey = useViewerStore(s => s.chatApiKey);
  const model = useViewerStore(s => s.chatModel);
  const setChatMessages = useViewerStore(s => s.setChatMessages);
  const setChatApiKey = useViewerStore(s => s.setChatApiKey);
  const setChatModel = useViewerStore(s => s.setChatModel);

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
    setChatApiKey(trimmed);
    setShowSettings(false);
    setKeyInput('');
  }, [setChatApiKey]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming || !apiKey || !scenario) return;

    const userMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setChatMessages([...newMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setStreaming(true);

    try {
      abortRef.current = new AbortController();
      const systemPrompt = buildSystemPrompt(scenario, step);

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
                const updatedMessages = [...newMessages, { role: 'assistant', content: accumulated }];
                setChatMessages(updatedMessages);
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
        const current = useViewerStore.getState().chatMessages;
        if (current.length > 0 && current[current.length - 1]?.content === '') {
          setChatMessages(current.slice(0, -1));
        }
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, apiKey, scenario, step, messages, model, setChatMessages]);

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
          <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 800 }}>CHAT</span>
          <select
            value={model}
            onChange={e => setChatModel(e.target.value)}
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
            {apiKey ? '🔑' : '⚠️ Key'}
          </button>
          <button
            onClick={() => { setChatMessages([]); setError(null); }}
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

      {/* Context indicator */}
      {scenario && (
        <div style={{
          padding: '6px 12px', background: '#0a1628', borderBottom: '1px solid #1e293b',
          flexShrink: 0,
        }}>
          <div style={{ color: '#475569', fontSize: 9 }}>
            Context: Step {step + 1} — {scenario.timeline[step]?.label?.slice(0, 60)}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {messages.length === 0 && !needsApiKey && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ color: '#475569', fontSize: 11, marginBottom: 8 }}>
              Ask about the current protocol step, packet fields, spec details, or anything RDMA/networking related.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                'What is happening at this step?',
                'Explain the BTH opcode field',
                'Why does RoCEv2 use UDP?',
                'What happens if the rkey is wrong?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
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
            placeholder={needsApiKey ? 'Set API key above...' : 'Ask about this protocol step...'}
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
