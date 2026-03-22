import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useChatStore, { macFromString, ipFromString, portFromString } from '../../../store/chatStore';
import useChatTransport from '../../../hooks/useChatTransport';
import PacketBuilder from './PacketBuilder';

export default function LiveChatPanel() {
  const { t } = useTranslation();
  const messages = useChatStore(s => s.messages);
  const nickname = useChatStore(s => s.nickname);
  const roomCode = useChatStore(s => s.roomCode);
  const mode = useChatStore(s => s.mode);
  const peerNicknames = useChatStore(s => s.peerNicknames);
  const {
    setCurrentPacket, addPacketToLog, setAnimationPhase, setAnimationDirection, setAnimationLayer,
    setPendingReceivedMsg, revealPendingMessage,
  } = useChatStore();
  const { send, peerCount, connectionStatus } = useChatTransport();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Orchestrate receive animation timeline:
  // 1. Wait for sender encapsulation to finish (transmitStartAt)
  // 2. Show bitstream on receiver side (simultaneous with sender's transmitting phase)
  // 3. Decapsulate L1→L7
  // 4. Reveal message in chat
  const receiveTimersRef = useRef([]);
  const pendingReceivedMsg = useChatStore(s => s.pendingReceivedMsg);

  useEffect(() => {
    if (!pendingReceivedMsg) return;
    const msg = pendingReceivedMsg;

    // Use the sender's network info so both sides show identical packet addresses
    const packet = PacketBuilder.build({
      text: msg.text,
      mode,
      seqNum: msg.seqNum,
      connectionInfo: msg.net,
    });

    const now = Date.now();
    const transmitStartAt = msg.transmitStartAt || now;
    const TRANSMIT_DURATION = 2000;
    const DECAP_DURATION = 6 * 600; // 3600ms

    // Clear any pending timers
    receiveTimersRef.current.forEach(t => clearTimeout(t));
    receiveTimersRef.current = [];

    // Phase 1: Wait for sender encap to finish, then show bitstream
    const bitstreamDelay = Math.max(0, transmitStartAt - now);
    const t1 = setTimeout(() => {
      setCurrentPacket(packet);
      addPacketToLog(packet);
      // Show bitstream (transmitting phase) on receiver — simultaneous with sender
      setAnimationDirection('up');
      setAnimationPhase('transmitting');
      setAnimationLayer(1);
    }, bitstreamDelay);
    receiveTimersRef.current.push(t1);

    // Phase 2: After bitstream completes, start decapsulation L1→L7
    const decapDelay = bitstreamDelay + TRANSMIT_DURATION;
    const t2 = setTimeout(() => {
      setAnimationPhase('decapsulating');
      setAnimationLayer(1);
    }, decapDelay);
    receiveTimersRef.current.push(t2);

    // Phase 3: After decapsulation completes, reveal message in chat
    const revealDelay = decapDelay + DECAP_DURATION;
    const t3 = setTimeout(() => {
      revealPendingMessage();
    }, revealDelay);
    receiveTimersRef.current.push(t3);

    return () => {
      receiveTimersRef.current.forEach(t => clearTimeout(t));
      receiveTimersRef.current = [];
    };
  }, [pendingReceivedMsg]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');

    const msgPayload = send(text);

    // Build packet for sent message — local is source, remote is destination
    // Use the same net info that was sent in the message payload
    const packet = PacketBuilder.build({
      text,
      mode,
      seqNum: msgPayload.seqNum,
      connectionInfo: msgPayload.net,
    });
    setCurrentPacket(packet);
    addPacketToLog(packet);

    // Trigger send animation (L7→L1)
    setAnimationDirection('down');
    setAnimationPhase('encapsulating');
    setAnimationLayer(7);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor = connectionStatus === 'connected' ? '#4ade80'
    : connectionStatus === 'connecting' ? '#facc15' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Status bar */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid #1e293b',
        background: '#0a0f1a', display: 'flex', alignItems: 'center',
        gap: 8, fontSize: 11, flexShrink: 0,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusColor, display: 'inline-block',
        }} />
        <span style={{ color: '#94a3b8' }}>
          {nickname}
        </span>
        <span style={{ color: '#475569' }}>•</span>
        <span style={{ color: '#475569', fontFamily: "'IBM Plex Mono', monospace" }}>
          {roomCode}
        </span>
        {peerCount > 0 && (
          <span style={{ color: '#475569', marginInlineStart: 'auto' }}>
            {peerCount} {t('helloChat.peers', 'peer(s)')}
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflow: 'auto', padding: 12, minHeight: 0,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && (
          <div style={{
            color: '#94a3b8', fontSize: 13, textAlign: 'center',
            padding: 40, lineHeight: 2,
          }}>
            {t('helloChat.emptyChat', 'Send a message to see it travel through the network stack.')}
            {mode === 1 && (() => {
              const shareUrl = `${window.location.origin}${window.location.pathname}#/live/hello-world-chat?room=${roomCode}&mode=${mode}`;
              return (
              <>
                <br /><br />
                <span style={{ color: '#64748b', fontSize: 12 }}>
                  {t('helloChat.openTab', 'Open another tab at this URL to chat with yourself.')}
                </span>
                <br />
                <code
                  onClick={() => navigator.clipboard?.writeText(shareUrl)}
                  title="Click to copy"
                  style={{
                    display: 'inline-block', marginTop: 8,
                    background: '#1e293b', color: '#60a5fa',
                    padding: '6px 14px', borderRadius: 6,
                    fontSize: 11, cursor: 'pointer',
                    border: '1px solid #334155',
                    wordBreak: 'break-all',
                    maxWidth: '100%',
                  }}
                >
                  {shareUrl}
                </code>
                <div style={{ color: '#475569', fontSize: 10, marginTop: 4 }}>
                  {t('helloChat.clickToCopy', 'Click to copy')}
                </div>
              </>
              );
            })()}
          </div>
        )}
        {messages.map(msg => {
          const isSent = msg.direction === 'sent';
          return (
            <div
              key={msg.id}
              style={{
                alignSelf: isSent ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
              }}
            >
              {!isSent && (
                <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2, paddingInlineStart: 8 }}>
                  {msg.sender}
                </div>
              )}
              <div style={{
                background: isSent ? '#1e40af' : '#1e293b',
                color: '#e2e8f0',
                padding: '8px 12px', borderRadius: 12,
                borderBottomEndRadius: isSent ? 4 : 12,
                borderBottomStartRadius: isSent ? 12 : 4,
                fontSize: 13, lineHeight: 1.5,
                wordBreak: 'break-word',
              }}>
                {msg.text}
              </div>
              <div style={{
                fontSize: 9, color: '#475569', marginTop: 2,
                textAlign: isSent ? 'end' : 'start',
                paddingInline: 8,
              }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {msg.seqNum != null && (
                  <span style={{ marginInlineStart: 6, fontFamily: "'IBM Plex Mono', monospace" }}>
                    seq:{msg.seqNum}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 12px', borderTop: '1px solid #1e293b',
        background: '#0a0f1a', display: 'flex', gap: 8,
        flexShrink: 0,
      }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('helloChat.inputPlaceholder', 'Type a message...')}
          style={{
            flex: 1, background: '#1e293b', border: '1px solid #334155',
            color: '#e2e8f0', borderRadius: 6, padding: '8px 12px',
            fontSize: 13, outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e => e.target.style.borderColor = '#334155'}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          style={{
            background: input.trim() ? '#3b82f6' : '#1e293b',
            border: input.trim() ? 'none' : '1px solid #334155',
            color: input.trim() ? '#fff' : '#94a3b8',
            padding: '8px 16px', borderRadius: 6,
            fontSize: 12, fontWeight: 600, cursor: input.trim() ? 'pointer' : 'default',
          }}
        >
          {t('common.send')}
        </button>
      </div>
    </div>
  );
}
