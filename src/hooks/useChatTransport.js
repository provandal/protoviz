import { useEffect, useRef, useCallback, useState } from 'react';
import useChatStore, { macFromString, ipFromString, portFromString } from '../store/chatStore';

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://protoviz.provandal.deno.net';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

/**
 * Chat transport abstraction.
 * Mode 1: BroadcastChannel (same machine)
 * Mode 2: WebRTC RTCDataChannel (P2P, signaling via relay)
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
  const wsRef = useRef(null);        // WebSocket (Mode 3)
  const pcRef = useRef(null);        // RTCPeerConnection (Mode 2)
  const dcRef = useRef(null);        // RTCDataChannel (Mode 2)
  const sigWsRef = useRef(null);     // Signaling WebSocket (Mode 2)
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

  // ─── Mode 2: WebRTC P2P with signaling via relay ───────────────────
  useEffect(() => {
    if (mode !== 2) return;

    let sigWs;
    let pc;
    let dc;
    let isOfferer = false;
    let cleanedUp = false;

    // Set up the DataChannel message handler (used by both offerer and answerer)
    function setupDataChannel(channel) {
      dc = channel;
      dcRef.current = dc;

      dc.onopen = () => {
        if (cleanedUp) return;
        setConnectionStatus('connected');
        // Close the signaling WebSocket — we're P2P now
        if (sigWs && sigWs.readyState === WebSocket.OPEN) {
          sigWs.close();
        }
      };

      dc.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'chat_message') {
          handleReceivedMessage(data.payload);
        }
      };

      dc.onclose = () => {
        if (cleanedUp) return;
        setConnectionStatus('disconnected');
        dcRef.current = null;
      };
    }

    // Create the RTCPeerConnection
    function createPeerConnection() {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        // Send ICE candidate to the other peer via signaling relay
        if (sigWs && sigWs.readyState === WebSocket.OPEN) {
          sigWs.send(JSON.stringify({
            type: 'signal',
            payload: { signalType: 'ice', candidate: e.candidate },
          }));
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (cleanedUp) return;
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setConnectionStatus('disconnected');
        }
      };

      // Answerer receives the DataChannel here
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel);
      };

      return pc;
    }

    // Start the offer (called when we're the first peer in the room)
    async function startOffer() {
      isOfferer = true;
      createPeerConnection();

      // Offerer creates the DataChannel
      const channel = pc.createDataChannel('protoviz-chat');
      setupDataChannel(channel);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sigWs.send(JSON.stringify({
        type: 'signal',
        payload: { signalType: 'offer', sdp: pc.localDescription },
      }));
    }

    // Handle incoming signaling messages
    async function handleSignal(payload) {
      if (payload.signalType === 'offer') {
        // We're the answerer
        if (!pc) createPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sigWs.send(JSON.stringify({
          type: 'signal',
          payload: { signalType: 'answer', sdp: pc.localDescription },
        }));
      } else if (payload.signalType === 'answer') {
        // We're the offerer, received the answer
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }
      } else if (payload.signalType === 'ice') {
        // ICE candidate from the other peer
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch { /* ignore late ICE candidates */ }
        }
      }
    }

    // Connect to the signaling relay
    setConnectionStatus('connecting');

    try {
      sigWs = new WebSocket(`${RELAY_URL}?room=${roomCode}&nick=${encodeURIComponent(nickname)}`);
    } catch {
      setConnectionStatus('disconnected');
      return;
    }
    sigWsRef.current = sigWs;

    sigWs.onopen = () => {
      sigWs.send(JSON.stringify({ type: 'join', payload: { sender: nickname } }));
    };

    sigWs.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const { type, payload } = data;

      if (type === 'peers') {
        const peerNames = (payload.nicknames || []).filter(n => n !== nickname);
        setPeerNicknames(peerNames);
        setPeerCount(peerNames.length);

        // When a second peer joins and we don't have a connection yet, the first peer initiates
        if (peerNames.length >= 1 && !pc && !isOfferer) {
          startOffer();
        }
      } else if (type === 'signal') {
        handleSignal(payload);
      }
    };

    sigWs.onerror = () => {
      if (!cleanedUp) setConnectionStatus('disconnected');
    };
    sigWs.onclose = () => {
      sigWsRef.current = null;
      // Only mark disconnected if we don't have a P2P channel
      if (!dc || dc.readyState !== 'open') {
        if (!cleanedUp) setConnectionStatus('disconnected');
      }
    };

    // Signaling heartbeat (keep WS alive until P2P is established)
    const heartbeat = setInterval(() => {
      if (sigWs.readyState === WebSocket.OPEN) {
        sigWs.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      cleanedUp = true;
      clearInterval(heartbeat);
      if (dc) { try { dc.close(); } catch { /* */ } }
      dcRef.current = null;
      if (pc) { try { pc.close(); } catch { /* */ } }
      pcRef.current = null;
      if (sigWs.readyState === WebSocket.OPEN || sigWs.readyState === WebSocket.CONNECTING) {
        sigWs.close();
      }
      sigWsRef.current = null;
      setConnectionStatus('disconnected');
    };
  }, [mode, roomCode, nickname]);

  // ─── Mode 3: WebSocket relay ───────────────────────────────────────
  useEffect(() => {
    if (mode !== 3) return;
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
        setPeerNicknames(payload.nicknames || []);
        setPeerCount(payload.nicknames?.length || 0);
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
    } else if (mode === 2 && dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify(msg));
    } else if (mode === 3 && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }

    return msg.payload;
  }, [mode, nickname, addMessage, advanceSequenceNumber]);

  return { send, peerCount, localIp, connectionStatus: useChatStore(s => s.connectionStatus) };
}
