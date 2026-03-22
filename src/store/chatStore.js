import { create } from 'zustand';

/** Deterministic MAC from a string (nickname). Stable across calls for the same input. */
function macFromString(str) {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const bytes = [
    (h >>> 0) & 0xff,
    (h >>> 8) & 0xff,
    (h >>> 16) & 0xff,
    (h >>> 24) & 0xff,
    ((h * 31) >>> 0) & 0xff,
    ((h * 37) >>> 0) & 0xff,
  ];
  // Set the locally-administered + unicast bits (bit 1 of first octet set, bit 0 clear)
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(':');
}

/** Deterministic IP in 192.168.1.x range from a string. */
function ipFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  const lastOctet = 2 + (Math.abs(h) % 253); // 2–254, avoids .0, .1, .255
  return `192.168.1.${lastOctet}`;
}

/** Deterministic ephemeral port from a string. */
function portFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 49152 + (Math.abs(h) % 16384);
}

const useChatStore = create((set, get) => ({
  // Topology / connection
  mode: null, // 1 = same machine, 2 = same network, 3 = anywhere
  connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
  nickname: '',
  roomCode: '',
  peerNicknames: [],

  // Messages
  messages: [], // { id, text, sender, timestamp, seqNum, direction: 'sent'|'received' }
  pendingReceivedMsg: null, // message waiting for decapsulation to complete before display

  // Packet inspection
  currentPacket: null,
  selectedField: null,
  packetLog: [], // history of all packets built

  // Animation
  animationPhase: 'idle', // 'idle' | 'encapsulating' | 'transmitting' | 'decapsulating'
  animationLayer: null, // 1-7
  animationDirection: null, // 'down' (send L7→L1) | 'up' (receive L1→L7)

  // TCP sequence tracking
  sequenceNumber: Math.floor(Math.random() * 0xFFFFFFFF),

  // Per-session network identity derived from nickname (stable, deterministic)
  localMAC: '02:00:00:00:00:00',
  localIp: '192.168.1.100',
  localPort: 49152,

  // Actions — topology
  setMode: (mode) => set({ mode }),
  setNickname: (nickname) => set({
    nickname,
    localMAC: macFromString(nickname),
    localIp: ipFromString(nickname),
    localPort: portFromString(nickname),
  }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setPeerNicknames: (peerNicknames) => set({ peerNicknames }),
  setLocalIp: (localIp) => set({ localIp }),

  // Actions — messages
  addMessage: (msg) => set(s => ({ messages: [...s.messages, msg] })),
  setPendingReceivedMsg: (msg) => set({ pendingReceivedMsg: msg }),
  revealPendingMessage: () => set(s => {
    if (!s.pendingReceivedMsg) return {};
    return {
      messages: [...s.messages, s.pendingReceivedMsg],
      pendingReceivedMsg: null,
    };
  }),
  clearMessages: () => set({ messages: [], pendingReceivedMsg: null }),

  // Actions — packet inspection
  setCurrentPacket: (currentPacket) => set({ currentPacket }),
  setSelectedField: (selectedField) => set({ selectedField }),
  addPacketToLog: (packet) => set(s => ({ packetLog: [...s.packetLog, packet] })),

  // Actions — animation
  setAnimationPhase: (animationPhase) => set({ animationPhase }),
  setAnimationLayer: (animationLayer) => set({ animationLayer }),
  setAnimationDirection: (animationDirection) => set({ animationDirection }),
  resetAnimation: () => set({
    animationPhase: 'idle',
    animationLayer: null,
    animationDirection: null,
  }),

  // Actions — sequence number
  advanceSequenceNumber: (byteCount) => set(s => ({
    sequenceNumber: (s.sequenceNumber + byteCount) >>> 0,
  })),

  // Reset all state
  reset: () => set({
    mode: null,
    connectionStatus: 'disconnected',
    nickname: '',
    roomCode: '',
    peerNicknames: [],
    messages: [],
    pendingReceivedMsg: null,
    currentPacket: null,
    selectedField: null,
    packetLog: [],
    animationPhase: 'idle',
    animationLayer: null,
    animationDirection: null,
    sequenceNumber: Math.floor(Math.random() * 0xFFFFFFFF),
    localMAC: '02:00:00:00:00:00',
    localIp: '192.168.1.100',
    localPort: 49152,
  }),
}));

export default useChatStore;
export { macFromString, ipFromString, portFromString };
