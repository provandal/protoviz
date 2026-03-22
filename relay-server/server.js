/**
 * ProtoViz Hello World Chat — WebSocket Relay Server
 *
 * Room-based message relay. No persistence, no storage of messages.
 * Designed for educational use with the Hello World Chat interactive scenario.
 *
 * Usage: PORT=8080 node server.js
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;
const MAX_CLIENTS_PER_ROOM = 10;
const MAX_MESSAGE_SIZE = 1024; // 1KB
const HEARTBEAT_INTERVAL = 30000;

// Room storage: Map<roomCode, Set<{ws, nick}>>
const rooms = new Map();

const server = http.createServer((req, res) => {
  // CORS headers for all HTTP responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.size,
      connections: Array.from(rooms.values()).reduce((sum, r) => sum + r.size, 0),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_SIZE });

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams(url.parse(req.url).query);
  const roomCode = (params.get('room') || '').toUpperCase().slice(0, 4);
  const nick = (params.get('nick') || 'Anon').slice(0, 20);

  if (!roomCode) {
    ws.close(4000, 'Missing room code');
    return;
  }

  // Create or join room
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, new Set());
  }
  const room = rooms.get(roomCode);

  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    ws.close(4001, 'Room is full');
    return;
  }

  const client = { ws, nick, alive: true };
  room.add(client);

  // Notify all peers of updated peer list
  broadcastPeers(roomCode);

  ws.on('message', (data) => {
    client.alive = true;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'chat_message' || msg.type === 'join' || msg.type === 'leave' || msg.type === 'signal') {
      // Relay to all other clients in the room
      for (const peer of room) {
        if (peer.ws !== ws && peer.ws.readyState === 1) {
          peer.ws.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on('close', () => {
    room.delete(client);
    if (room.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcastPeers(roomCode);
    }
  });

  ws.on('error', () => {
    room.delete(client);
    if (room.size === 0) rooms.delete(roomCode);
  });
});

function broadcastPeers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const nicknames = Array.from(room).map(c => c.nick);
  const msg = JSON.stringify({ type: 'peers', payload: { nicknames } });
  for (const client of room) {
    if (client.ws.readyState === 1) {
      client.ws.send(msg);
    }
  }
}

// Heartbeat: detect dead connections
const heartbeat = setInterval(() => {
  for (const [roomCode, room] of rooms) {
    for (const client of room) {
      if (!client.alive) {
        client.ws.terminate();
        room.delete(client);
        continue;
      }
      client.alive = false;
      if (client.ws.readyState === 1) {
        client.ws.ping();
      }
    }
    if (room.size === 0) rooms.delete(roomCode);
  }
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`ProtoViz relay server listening on port ${PORT}`);
});
