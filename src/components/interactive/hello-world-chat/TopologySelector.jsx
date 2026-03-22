import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useChatStore from '../../../store/chatStore';
import LanguageSelector from '../../common/LanguageSelector';

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://protoviz-relay.deno.dev';

const MODES = [
  {
    id: 1,
    icon: '🖥️',
    titleKey: 'helloChat.modeSameMachine',
    titleFallback: 'Same Machine',
    descKey: 'helloChat.modeSameMachineDesc',
    descFallback: 'Two browser tabs on this computer. Messages travel through BroadcastChannel — never leave your machine.',
    layers: 'L7 → L1 (simulated)',
    color: '#4ade80',
    requiresRelay: false,
    requiresKey: 'helloChat.reqNone',
    requiresFallback: 'No setup required — open two tabs and start chatting.',
  },
  {
    id: 2,
    icon: '🏠',
    titleKey: 'helloChat.modeSameNetwork',
    titleFallback: 'Same Network',
    descKey: 'helloChat.modeSameNetworkDesc',
    descFallback: 'Two devices on your local WiFi or LAN. Messages travel directly between browsers via WebRTC — true peer-to-peer.',
    layers: 'L7 → L1 (WebRTC P2P)',
    color: '#60a5fa',
    requiresRelay: true,
    requiresKey: 'helloChat.reqWebRTC',
    requiresFallback: 'WebRTC-capable browser. Brief cloud signaling, then direct P2P.',
  },
  {
    id: 3,
    icon: '🌍',
    titleKey: 'helloChat.modeAnywhere',
    titleFallback: 'Anywhere on Earth',
    descKey: 'helloChat.modeAnywhereDesc',
    descFallback: 'Two devices anywhere in the world. Messages travel through a cloud relay — real internet routing.',
    layers: 'L7 → L1 (internet)',
    color: '#c084fc',
    requiresRelay: true,
    requiresKey: 'helloChat.reqCloudRelay',
    requiresFallback: 'Cloud relay server.',
  },
];

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default function TopologySelector({ initialRoom = '', initialMode = null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setMode, setNickname, setRoomCode, setConnectionStatus } = useChatStore();
  const [selectedMode, setSelectedMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialRoom);
  const [geoLanguage, setGeoLanguage] = useState(null);
  const [relayStatus, setRelayStatus] = useState('checking'); // 'checking' | 'online' | 'offline'

  // If we have both a room and mode from URL, we're joining an existing room
  const isJoining = !!(initialRoom && initialMode);

  // Check relay server health on mount
  useEffect(() => {
    const healthUrl = RELAY_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') + '/health';
    const controller = new AbortController();
    fetch(healthUrl, { signal: controller.signal, mode: 'cors' })
      .then(res => res.ok ? setRelayStatus('online') : setRelayStatus('offline'))
      .catch(() => setRelayStatus('offline'));
    return () => controller.abort();
  }, []);

  // Detect language via GeoLingua on mount
  useEffect(() => {
    let cancelled = false;
    import('geolingua').then(mod => {
      if (cancelled) return;
      const detect = mod.detectLanguage || mod.default?.detectLanguage;
      if (detect) {
        try {
          const result = detect();
          if (result && !cancelled) setGeoLanguage(result);
        } catch { /* ignore detection failures */ }
      }
    }).catch(() => { /* geolingua not available */ });
    return () => { cancelled = true; };
  }, []);

  // Does the selected mode require a relay that isn't online?
  const selectedModeConfig = MODES.find(m => m.id === selectedMode);
  const needsRelayButOffline = selectedModeConfig?.requiresRelay && relayStatus !== 'online';
  const canStart = selectedMode && name.trim() && !needsRelayButOffline;

  const handleStart = () => {
    if (!canStart) return;
    const finalCode = code.trim() || generateRoomCode();
    setNickname(name.trim());
    setRoomCode(finalCode);
    setConnectionStatus('connecting');
    setMode(selectedMode);
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#020817', color: '#e2e8f0',
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', color: '#64748b',
              cursor: 'pointer', fontSize: 14, padding: '4px 8px',
            }}
          >
            ← {t('common.back')}
          </button>
          <div style={{
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            borderRadius: 6, padding: '3px 10px',
          }}>
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 800, letterSpacing: '0.05em' }}>
              PROTO<span style={{ color: '#a5f3fc' }}>VIZ</span>
            </span>
          </div>
        </div>
        <LanguageSelector />
      </div>

      {/* Content */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '40px 24px',
        maxWidth: 900, margin: '0 auto', width: '100%',
      }}>
        <h1 style={{
          fontSize: 28, fontWeight: 800, marginBottom: 8,
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          {t('helloChat.title', 'Hello World Chat')}
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 32, textAlign: 'center', maxWidth: 500 }}>
          {isJoining
            ? t('helloChat.joinSubtitle', 'You\'ve been invited to a chat room. Enter your name to join.')
            : t('helloChat.subtitle', 'Send a real message and watch every protocol layer animate as your data travels the network stack.')}
        </p>

        {/* Joining banner — show room code and mode */}
        {isJoining && (
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
            padding: '12px 20px', marginBottom: 24, textAlign: 'center',
          }}>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>
              {t('helloChat.joiningRoom', 'Joining room')}
            </div>
            <div style={{
              color: '#e2e8f0', fontSize: 24, fontWeight: 700,
              fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.2em',
            }}>
              {initialRoom}
            </div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
              {MODES.find(m => m.id === initialMode)
                ? t(MODES.find(m => m.id === initialMode).titleKey, MODES.find(m => m.id === initialMode).titleFallback)
                : ''}
            </div>
          </div>
        )}

        {/* GeoLingua detected language hint */}
        {!isJoining && geoLanguage && (
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
            padding: '8px 16px', marginBottom: 24, fontSize: 12, color: '#94a3b8',
          }}>
            {t('helloChat.geoDetected', 'Detected region')}: {geoLanguage.language || geoLanguage.code || JSON.stringify(geoLanguage)}
          </div>
        )}

        {/* Nickname input */}
        <div style={{ width: '100%', maxWidth: 400, marginBottom: 32 }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
            {t('helloChat.nickname', 'Your nickname')}
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('helloChat.nicknamePlaceholder', 'e.g., Alice')}
            maxLength={20}
            autoFocus={isJoining}
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #334155',
              color: '#e2e8f0', borderRadius: 6, padding: '10px 14px',
              fontSize: 14, outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = '#3b82f6'}
            onBlur={e => e.target.style.borderColor = '#334155'}
            onKeyDown={e => { if (e.key === 'Enter' && isJoining && name.trim()) handleStart(); }}
          />
        </div>

        {/* Mode cards — only shown when NOT joining via URL */}
        {!isJoining && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16, width: '100%', marginBottom: 32,
          }}>
            {MODES.map(m => {
              const isSelected = selectedMode === m.id;
              const relayOk = !m.requiresRelay || relayStatus === 'online';
              const relayChecking = m.requiresRelay && relayStatus === 'checking';
              const relayDown = m.requiresRelay && relayStatus === 'offline';
              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedMode(m.id)}
                  style={{
                    background: isSelected ? '#0f172a' : '#0a0f1a',
                    border: `2px solid ${isSelected ? m.color : '#1e293b'}`,
                    borderRadius: 12, padding: 24,
                    cursor: 'pointer',
                    transition: 'border-color 0.2s, transform 0.15s',
                    transform: isSelected ? 'translateY(-2px)' : 'none',
                    opacity: relayDown && !isSelected ? 0.6 : 1,
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = m.color + '66';
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = '#1e293b';
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 12 }}>{m.icon}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: m.color, marginBottom: 8 }}>
                    {t(m.titleKey, m.titleFallback)}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
                    {t(m.descKey, m.descFallback)}
                  </div>
                  <div style={{
                    color: '#475569', fontSize: 10, fontWeight: 600,
                    background: '#1e293b', display: 'inline-block',
                    padding: '2px 8px', borderRadius: 3, marginBottom: 10,
                  }}>
                    {m.layers}
                  </div>

                  {/* Requirements */}
                  <div style={{
                    borderTop: '1px solid #1e293b', paddingTop: 10, marginTop: 4,
                    fontSize: 11, lineHeight: 1.6,
                  }}>
                    <div style={{ color: '#64748b', fontWeight: 600, marginBottom: 4 }}>
                      {t('helloChat.requires', 'Requires')}
                    </div>
                    <div style={{ color: '#94a3b8' }}>
                      {t(m.requiresKey, m.requiresFallback)}
                    </div>
                    {m.requiresRelay && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        marginTop: 6, fontSize: 10,
                      }}>
                        <span style={{
                          width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
                          background: relayStatus === 'online' ? '#4ade80'
                            : relayStatus === 'checking' ? '#facc15' : '#ef4444',
                        }} />
                        <span style={{
                          color: relayStatus === 'online' ? '#4ade80'
                            : relayStatus === 'checking' ? '#facc15' : '#ef4444',
                          fontWeight: 600,
                        }}>
                          {relayStatus === 'online'
                            ? t('helloChat.relayOnline', 'Relay server online')
                            : relayStatus === 'checking'
                              ? t('helloChat.relayChecking', 'Checking relay...')
                              : t('helloChat.relayOffline', 'Relay server offline')}
                        </span>
                        {relayStatus === 'offline' && isSelected && (
                          <span style={{ color: '#64748b' }}>
                            — {t('helloChat.relaySetupHint', 'see setup instructions below')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Room code input (Modes 2 & 3, only when NOT joining) */}
        {!isJoining && (selectedMode === 2 || selectedMode === 3) && (
          <div style={{ width: '100%', maxWidth: 400, marginBottom: 32 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 6 }}>
              {t('helloChat.roomCode', 'Room code (leave empty to create a new room)')}
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="e.g., AB34"
              maxLength={4}
              style={{
                width: '100%', background: '#1e293b', border: '2px solid #334155',
                color: '#e2e8f0', borderRadius: 8, padding: '14px 18px',
                fontSize: 32, fontWeight: 800, letterSpacing: '0.25em',
                textAlign: 'center', outline: 'none',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e => e.target.style.borderColor = '#334155'}
            />
          </div>
        )}

        {/* Start / Join button */}
        <button
          onClick={handleStart}
          disabled={!canStart}
          style={{
            background: !canStart
              ? '#1e293b'
              : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            border: !canStart ? '1px solid #334155' : 'none',
            color: !canStart ? '#94a3b8' : '#fff',
            padding: '12px 40px', borderRadius: 8,
            fontSize: 16, fontWeight: 700, cursor: !canStart ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.2s',
          }}
        >
          {isJoining
            ? t('helloChat.join', 'Join Chat')
            : t('helloChat.start', 'Start Chatting')}
        </button>

        {/* Relay setup instructions — shown when user selected Mode 2/3 but relay is offline */}
        {!isJoining && needsRelayButOffline && (
          <div style={{
            marginTop: 24, maxWidth: 520, width: '100%',
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
            padding: '20px 24px',
          }}>
            <div style={{
              color: '#ef4444', fontSize: 13, fontWeight: 700, marginBottom: 12,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
                display: 'inline-block',
              }} />
              {t('helloChat.relayOffline', 'Relay server offline')}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.8 }}>
              <p style={{ color: '#e2e8f0', margin: '0 0 12px 0' }}>
                {t('helloChat.relayExplain', 'This mode requires a lightweight relay server to connect browsers. The relay is a small open-source program that forwards messages between participants.')}
              </p>
              <p style={{ color: '#94a3b8', margin: '0 0 16px 0', fontSize: 11 }}>
                {t('helloChat.relayPrivacy', 'The relay sees only encrypted room codes — it cannot read your messages and stores nothing.')}
              </p>

              <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 10, fontSize: 12 }}>
                {t('helloChat.setupTitle', 'How to get started:')}
              </div>

              {/* Self-host option */}
              <div style={{
                background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
                padding: '12px 16px', marginBottom: 10,
              }}>
                <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  {t('helloChat.setupSelfHost', '1. Run it yourself (2 minutes)')}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>
                  {t('helloChat.setupCloneInstructions', 'Clone the ProtoViz repo, then run the relay:')}
                </div>
                <code style={{
                  display: 'block', background: '#020817', color: '#60a5fa',
                  padding: '10px 14px', borderRadius: 6, fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace", lineHeight: 2,
                  border: '1px solid #1e293b',
                }}>
                  git clone https://github.com/provandal/protoviz.git<br />
                  cd protoviz/relay-server<br />
                  npm install && npm start
                </code>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 6 }}>
                  {t('helloChat.setupLocalNote', 'Runs on port 8080. Set VITE_RELAY_URL=ws://localhost:8080 in .env if running the app locally.')}
                </div>
              </div>

              {/* Cloud deploy option */}
              <div style={{
                background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
                padding: '12px 16px', marginBottom: 10,
              }}>
                <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                  {t('helloChat.setupCloud', '2. Deploy to the cloud for free')}
                </div>
                <ol style={{
                  color: '#94a3b8', fontSize: 11, lineHeight: 2,
                  margin: '0', paddingInlineStart: 18,
                }}>
                  <li>{t('helloChat.setupCloudStep1', 'Fork the ProtoViz repo on GitHub')}</li>
                  <li>{t('helloChat.setupCloudStep2', 'Go to console.deno.com and sign in (free)')}</li>
                  <li>{t('helloChat.setupCloudStep3', 'Click "New Project" → "Deploy from GitHub"')}</li>
                  <li>{t('helloChat.setupCloudStep4', 'Select your forked protoviz repository')}</li>
                  <li>{t('helloChat.setupCloudStep5', 'Set the entry point to relay-server/deno-relay.ts')}</li>
                  <li>{t('helloChat.setupCloudStep6', 'Name the project (e.g., protoviz-relay) and click Deploy')}</li>
                </ol>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 6 }}>
                  {t('helloChat.setupCloudNote', 'Your relay URL will be https://your-project-name.deno.dev. It auto-deploys on every push.')}
                </div>
              </div>

              {/* Links */}
              <div style={{
                display: 'flex', gap: 16, marginTop: 4, fontSize: 11,
              }}>
                <a
                  href="https://github.com/provandal/protoviz/tree/main/relay-server"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#3b82f6', textDecoration: 'none' }}
                >
                  {t('helloChat.setupViewSource', 'View relay source on GitHub')}
                </a>
                <a
                  href="https://dash.deno.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#3b82f6', textDecoration: 'none' }}
                >
                  {t('helloChat.setupDenoDashboard', 'Deno Deploy dashboard')}
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
