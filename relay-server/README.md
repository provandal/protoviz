# ProtoViz Relay Server

WebSocket relay for the Hello World Chat interactive scenario. Routes messages between browsers using 4-character room codes. Also serves as the signaling relay for Mode 2 WebRTC peer-to-peer connections.

## Deno Deploy (Production)

The recommended deployment target. Free tier — no credit card required.

1. Push this repo to GitHub
2. Go to [dash.deno.com](https://dash.deno.com) and create a new project
3. Link the GitHub repo, set entry point to `relay-server/deno-relay.ts`
4. Deno Deploy auto-deploys on every push

The deployed URL (e.g., `https://protoviz-relay.deno.dev`) is the default relay in `useChatTransport.js`.

### Local Deno Development

```bash
cd relay-server
deno task dev
# Server listens on port 8080
```

## Node.js (Local Development Alternative)

If you don't have Deno installed, the Node.js server provides identical functionality.

```bash
cd relay-server
npm install
npm start
# Server listens on port 8080
```

Set `VITE_RELAY_URL=ws://localhost:8080` in the ProtoViz `.env` file to use the local relay.

## Protocol

Messages are JSON with `{ type, payload }` structure. The relay forwards these types to other clients in the same room:

- `chat_message` — chat data (Mode 3)
- `signal` — WebRTC SDP offers, answers, and ICE candidates (Mode 2 signaling)
- `join` / `leave` — presence notifications

The relay also sends:

- `peers` — `{ nicknames: string[] }` broadcast when the room membership changes
- `pong` — response to client `ping` heartbeats

## Limits

- Max 10 clients per room
- Max 1KB per message
- 30-second heartbeat interval
- No message persistence — relay only
