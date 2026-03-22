import { useEffect, useRef, useCallback, useState } from 'react';
import useChatStore, { macFromString, ipFromString, portFromString } from '../store/chatStore';

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://protoviz.provandal.deno.net';

/**
 * Chat transport abstraction.
 * Mode 1: BroadcastChannel (same machine)
 * Mode 2: WebSocket relay (same network — future: WebRTC P2P upgrade)
 * Mode 3: WebSocket relay (anywhere)
 */
export default function useChatTransport() {
  const mode = useChatStore(s => s.mode);
  const roomCode = useChatStore(s => s.roomCode);
  const nickname = useChatStore(s => s.nickname);
  const {
    setConnectionStatus, addMessage, setPendingReceivedMsg, setPeerNicknames,
    setCurrentPacket, addPacketToLog, sequenceNumber, advanceSequenceNumber,
    setLocalIp,
  } = useChatStore();
  const localIp = useChatStore(s => s.localIp);

  const channelRef = useRef(null);   // BroadcastChannel (Mode 1)
  const wsRef = useRef(null);        // WebSocket (Mode 2 & 3)
  const [peerCount, setPeerCount] = useState(0);

  // Helper: parse a received chat message into a pending message
  function handleReceivedMessage(payload) {
    setPendingReceivedMsg({
      id: payload.id || crypto.randomUUID(),
      text: payload.text,
      sender: payload.sender,
      timestamp: payload.timestamp,
      seqNum: payload.seqNum,
      transmitStartAt: payload.transmitStartAt,
      animationDoneAt: payload.animationDoneAt,
      net: payload.net,
      direction: 'received',
    });
  }

  // Detect local IP via WebRTC ICE (for Mode 2/3)
  useEffect(() => {
    if (mode !== 2 && mode !== 3) return;
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          setLocalIp(match[1]);
          pc.close();
        }
      };
      setTimeout(() => pc.close(), 5000);
    } catch { /* ICE discovery not available */ }
  }, [mode]);

  // ─── Mode 1: BroadcastChannel ───────────────────────────────────────
  useEffect(() => {
    if (mode !== 1) return;
    const channelName = `protoviz-hello-chat-${roomCode}`;
    const bc = new BroadcastChannel(channelName);
    channelRef.current = bc;

    bc.postMessage({ type: 'join', payload: { sender: nickname } });
    setConnectionStatus('connected');

    const peers = new Set();

    bc.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'join') {
        peers.add(payload.sender);
        setPeerNicknames([...peers]);
        setPeerCount(peers.size);
        bc.postMessage({ type: 'presence', payload: { sender: nickname } });
      } else if (type === 'presence') {
        peers.add(payload.sender);
        setPeerNicknames([...peers]);
        setPeerCount(peers.size);
      } else if (type === 'chat_message') {
        handleReceivedMessage(payload);
      } else if (type === 'leave') {
        peers.delete(payload.sender);
        setPeerNicknames([...peers]);
        setPeerCount(peers.size);
      }
    };

    return () => {
      bc.postMessage({ type: 'leave', payload: { sender: nickname } });
      bc.close();
      channelRef.current = null;
      setConnectionStatus('disconnected');
    };
  }, [mode, roomCode, nickname]);

  // ─── Mode 2 & 3: WebSocket relay ──────────────────────────────────
  // Mode 2 (Same Network) and Mode 3 (Anywhere) both use the relay.
  // The only difference is the UI label; transport is identical.
  // True WebRTC P2P upgrade for Mode 2 is a future enhancement.
  useEffect(() => {
    if (mode !== 2 && mode !== 3) return;
    let ws;
    try {
      ws = new WebSocket(`${RELAY_URL}?room=${roomCode}&nick=${encodeURIComponent(nickname)}`);
    } catch {
      setConnectionStatus('disconnected');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      ws.send(JSON.stringify({ type: 'join', payload: { sender: nickname } }));
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const { type, payload } = data;
      if (type === 'chat_message') {
        handleReceivedMessage(payload);
      } else if (type === 'peer_count') {
        setPeerCount(payload.count || 0);
      } else if (type === 'peers') {
        const others = (payload.nicknames || []).filter(n => n !== nickname);
        setPeerNicknames(others);
        setPeerCount(others.length);
      }
    };

    ws.onerror = () => setConnectionStatus('disconnected');
    ws.onclose = () => {
      setConnectionStatus('disconnected');
      wsRef.current = null;
    };

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      clearInterval(heartbeat);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
      setConnectionStatus('disconnected');
    };
  }, [mode, roomCode, nickname]);

  // ─── Send ──────────────────────────────────────────────────────────
  const send = useCallback((text) => {
    const state = useChatStore.getState();
    const seqNum = state.sequenceNumber;
    const ENCAP_DURATION = 6 * 600;
    const TRANSMIT_DURATION = 2000;
    const now = Date.now();

    const peerNick = state.peerNicknames[0] || 'server';
    const net = {
      srcIp: ipFromString(nickname), dstIp: ipFromString(peerNick),
      srcMAC: macFromString(nickname), dstMAC: macFromString(peerNick),
      srcPort: portFromString(nickname), dstPort: 443,
    };

    const msg = {
      type: 'chat_message',
      payload: {
        id: crypto.randomUUID(),
        text,
        sender: nickname,
        timestamp: now,
        seqNum,
        transmitStartAt: now + ENCAP_DURATION,
        animationDoneAt: now + ENCAP_DURATION + TRANSMIT_DURATION,
        net,
      },
    };

    addMessage({ ...msg.payload, direction: 'sent' });

    const byteCount = new TextEncoder().encode(text).length;
    advanceSequenceNumber(byteCount);

    // Send via transport
    if (mode === 1 && channelRef.current) {
      channelRef.current.postMessage(msg);
    } else if ((mode === 2 || mode === 3) && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }

    return msg.payload;
  }, [mode, nickname, addMessage, advanceSequenceNumber]);

  return { send, peerCount, localIp, connectionStatus: useChatStore(s => s.connectionStatus) };
}
