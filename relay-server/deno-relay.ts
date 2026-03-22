/**
 * ProtoViz Hello World Chat — Deno Deploy WebSocket Relay
 *
 * Room-based message relay for Mode 3 (Anywhere) and signaling relay for Mode 2 (WebRTC P2P).
 * No persistence, no storage of messages.
 *
 * Local: deno run --allow-net deno-relay.ts
 * Deploy: push to GitHub, link repo in Deno Deploy dashboard (https://dash.deno.com)
 */

const MAX_CLIENTS_PER_ROOM = 10;
const MAX_MESSAGE_SIZE = 1024; // 1KB
const HEARTBEAT_INTERVAL = 30_000;

interface Client {
  ws: WebSocket;
  nick: string;
  alive: boolean;
}

const rooms = new Map<string, Set<Client>>();

function broadcastPeers(roomCode: string) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const nicknames = Array.from(room).map((c) => c.nick);
  const msg = JSON.stringify({ type: "peers", payload: { nicknames } });
  for (const client of room) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

function relayToOthers(room: Set<Client>, sender: WebSocket, data: string) {
  for (const peer of room) {
    if (peer.ws !== sender && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  }
}

// Heartbeat: detect dead connections
setInterval(() => {
  for (const [roomCode, room] of rooms) {
    for (const client of room) {
      if (!client.alive) {
        try { client.ws.close(); } catch { /* ignore */ }
        room.delete(client);
        continue;
      }
      client.alive = false;
    }
    if (room.size === 0) rooms.delete(roomCode);
    else broadcastPeers(roomCode);
  }
}, HEARTBEAT_INTERVAL);

Deno.serve({ port: Number(Deno.env.get("PORT") || 8080) }, (req: Request) => {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === "/health") {
    const connections = Array.from(rooms.values()).reduce(
      (sum, r) => sum + r.size,
      0,
    );
    return new Response(
      JSON.stringify({ status: "ok", rooms: rooms.size, connections }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // WebSocket upgrade
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426 });
  }

  const roomCode = (url.searchParams.get("room") || "").toUpperCase().slice(0, 4);
  if (!roomCode) {
    return new Response("Missing room code", { status: 400 });
  }

  const nick = (url.searchParams.get("nick") || "Anon").slice(0, 20);

  // Create or join room
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, new Set());
  }
  const room = rooms.get(roomCode)!;

  if (room.size >= MAX_CLIENTS_PER_ROOM) {
    return new Response("Room full", { status: 429 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  const client: Client = { ws: socket, nick, alive: true };

  socket.onopen = () => {
    room.add(client);
    broadcastPeers(roomCode);
  };

  socket.onmessage = (event: MessageEvent) => {
    client.alive = true;

    if (typeof event.data !== "string") return;
    if (event.data.length > MAX_MESSAGE_SIZE) return;

    let msg: { type: string };
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // Relay chat messages, join/leave, and WebRTC signaling to other clients
    if (
      msg.type === "chat_message" ||
      msg.type === "join" ||
      msg.type === "leave" ||
      msg.type === "signal"
    ) {
      relayToOthers(room, socket, event.data);
    }
  };

  socket.onclose = () => {
    room.delete(client);
    if (room.size === 0) {
      rooms.delete(roomCode);
    } else {
      broadcastPeers(roomCode);
    }
  };

  socket.onerror = () => {
    room.delete(client);
    if (room.size === 0) rooms.delete(roomCode);
  };

  return response;
});
