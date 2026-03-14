import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
];

const EXAMPLE_PROMPTS = [
  'TCP three-way handshake between a client and a web server, including SYN, SYN-ACK, and ACK with typical field values',
  'ARP request and reply between two hosts on the same subnet, showing how MAC addresses are resolved',
  'NVMe-oF/TCP connection setup: TCP handshake, then NVMe-oF Connect command and response',
  'iWARP RDMA Write over TCP, showing MPA framing and DDP/RDMAP headers',
];

function buildSystemPrompt(schemaText) {
  return `You are a protocol education expert that creates ProtoViz scenario YAML files.

Given a description of a protocol exchange, generate a complete, valid YAML scenario file that conforms to the ProtoViz schema.

IMPORTANT RULES:
1. Output ONLY valid YAML — no markdown fences, no explanatory text before or after
2. Include realistic field values (real opcodes, typical port numbers, plausible IPs/MACs)
3. Every field MUST have a description explaining what it means in context
4. Include spec_refs where you know the relevant standard (RFC, IEEE, IBTA, etc.)
5. Include kernel_ref for Linux kernel source where relevant
6. The timeline should tell a complete story with annotations explaining each step
7. Use the exact structure from the schema: meta, topology, osi_layers, frames, timeline, glossary
8. Each timeline event needs: id, type (frame_tx or state_change), annotation (text + detail), and state_after
9. Frame events need: from, to, frame_id referencing the frames section
10. Include a glossary section defining protocol-specific terms

Here is the ProtoViz scenario JSON Schema for reference:

${schemaText}

Remember: output ONLY the YAML content, nothing else.`;
}

export default function ScenarioCreator() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('protoviz_api_key') || '');
  const [keyInput, setKeyInput] = useState('');
  const [model, setModel] = useState(() => localStorage.getItem('protoviz_model') || MODELS[0].id);
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [yamlOutput, setYamlOutput] = useState('');
  const [error, setError] = useState(null);
  const [schemaText, setSchemaText] = useState(null);
  const abortRef = useRef(null);

  // Load schema on first use
  const loadSchema = useCallback(async () => {
    if (schemaText) return schemaText;
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}scenario.schema.json`);
    const text = await res.text();
    setSchemaText(text);
    return text;
  }, [schemaText]);

  const saveApiKey = useCallback((key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem('protoviz_api_key', trimmed);
    setKeyInput('');
  }, []);

  const generate = useCallback(async () => {
    if (!description.trim() || generating || !apiKey) return;

    setGenerating(true);
    setError(null);
    setYamlOutput('');

    try {
      const schema = await loadSchema();
      abortRef.current = new AbortController();

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
          max_tokens: 16384,
          system: buildSystemPrompt(schema),
          messages: [{ role: 'user', content: description.trim() }],
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
                setYamlOutput(accumulated);
              }
            } catch {
              // Skip
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      setGenerating(false);
    }
  }, [description, generating, apiKey, model, loadSchema]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, []);

  const downloadYaml = useCallback(() => {
    if (!yamlOutput) return;
    const blob = new Blob([yamlOutput], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'scenario.yaml';
    a.click();
    URL.revokeObjectURL(url);
  }, [yamlOutput]);

  const copyYaml = useCallback(() => {
    if (yamlOutput) navigator.clipboard.writeText(yamlOutput);
  }, [yamlOutput]);

  const needsApiKey = !apiKey;

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
        <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>Scenario Creator</span>
        <div style={{ flex: 1 }} />
        <select
          value={model}
          onChange={e => { setModel(e.target.value); localStorage.setItem('protoviz_model', e.target.value); }}
          style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', fontSize: 10, borderRadius: 3, padding: '2px 4px', cursor: 'pointer' }}
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel: input */}
        <div style={{ width: 420, flexShrink: 0, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* API key */}
          {needsApiKey && (
            <div style={{ padding: 12, background: '#0f172a', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
              <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 6 }}>Anthropic API Key (required)</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveApiKey(keyInput)}
                  style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', fontSize: 11, padding: '4px 8px', borderRadius: 4, outline: 'none', fontFamily: 'monospace' }}
                />
                <button onClick={() => saveApiKey(keyInput)} style={{ background: '#1e40af', border: 'none', color: '#fff', fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          )}

          {/* Description input */}
          <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
            <div style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Describe Your Protocol Exchange
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the protocol exchange you want to visualize. Include the protocol, the actors involved, and the key steps in the exchange..."
              style={{
                flex: 1, minHeight: 150, background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                fontSize: 12, padding: 12, borderRadius: 6, outline: 'none',
                resize: 'none', fontFamily: "'IBM Plex Sans',system-ui,sans-serif", lineHeight: 1.6,
              }}
            />

            <button
              onClick={generating ? stopGeneration : generate}
              disabled={needsApiKey || (!generating && !description.trim())}
              style={{
                marginTop: 12,
                background: generating ? '#991b1b' : 'linear-gradient(135deg, #1e40af, #7c3aed)',
                border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 6,
                cursor: (needsApiKey || (!generating && !description.trim())) ? 'not-allowed' : 'pointer',
                fontSize: 13, fontWeight: 600,
                opacity: (needsApiKey || (!generating && !description.trim())) ? 0.4 : 1,
              }}
            >
              {generating ? 'Stop Generation' : 'Generate Scenario'}
            </button>

            {error && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: '#450a0a', border: '1px solid #dc2626', borderRadius: 6, color: '#fca5a5', fontSize: 10 }}>
                {error}
              </div>
            )}

            {/* Example prompts */}
            <div style={{ marginTop: 16 }}>
              <div style={{ color: '#334155', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Examples
              </div>
              {EXAMPLE_PROMPTS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setDescription(p)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', marginBottom: 4,
                    background: '#0f172a', border: '1px solid #1e293b', color: '#64748b',
                    fontSize: 10, padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                    lineHeight: 1.4,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel: YAML output */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Toolbar */}
          <div style={{
            padding: '6px 12px', background: '#0f172a', borderBottom: '1px solid #1e293b',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            <span style={{ color: '#475569', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Generated YAML
            </span>
            <div style={{ flex: 1 }} />
            {yamlOutput && (
              <>
                <button onClick={copyYaml} style={{ background: 'none', border: '1px solid #334155', color: '#64748b', padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}>
                  Copy
                </button>
                <button onClick={downloadYaml} style={{ background: '#1e40af', border: 'none', color: '#fff', padding: '2px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 10 }}>
                  Download .yaml
                </button>
              </>
            )}
          </div>

          {/* YAML content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
            {yamlOutput ? (
              <pre style={{
                margin: 0, padding: 12, color: '#cbd5e1', fontSize: 11,
                fontFamily: "'IBM Plex Mono', 'Consolas', monospace",
                lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {yamlOutput}
                {generating && <span style={{ color: '#3b82f6', animation: 'pulse 1s infinite' }}>|</span>}
              </pre>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#1e293b', fontSize: 12 }}>
                {generating ? 'Generating scenario...' : 'Describe a protocol exchange and click Generate'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
