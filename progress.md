# anochat — progress and learning notes

Updated: 2026-11-19

## Current goal

A minimal terminal-style, no-login chat for temporary groups and quick formatted code sharing across phone/PC/college computers.

## Phase 2 — requested simplification and group messaging

- [x] Removed homepage logo, oversized hero, tagline and promotional copy
- [x] Kept a plain dark terminal layout: anochat, duration, people, create room
- [x] Room duration defaults to 5 minutes (other options: 10, 30)
- [x] Room capacity defaults to 4 people, selectable from 2 through 10
- [x] Room API enforces configured capacity and maintains connected participant list
- [x] Group chat publishes messages to all connected people in a room
- [x] Added browser-side AES-256-GCM message encryption with random IV per message
- [x] Invite URL includes encryption key in fragment, never sent as an API/Socket.IO parameter
- [x] Server accepts/stores ciphertext + IV, not plaintext
- [x] Copied code keeps spaces, tabs and line breaks; use Ctrl+Enter to send
- [x] Retry-safe client message IDs and server duplicate suppression in active message history
- [x] Added group-capacity tests and encryption round-trip/wrong-key tests
- [x] GitHub Actions Node 22: server unit tests, client AES-GCM tests and Vite build passed (commit a4b338f)
- [ ] Deploy persistent backend and configure frontend environment variables
- [ ] Two real devices: join / send / reconnect / full room / expiry smoke test

## Key architectural concepts

1. HTTP POST creates a room and saves `duration` and `maxParticipants`.
2. Socket.IO joins the specific room and fans out group chat state to all members.
3. Each browser has a random participant ID in sessionStorage. This is a reconnect convenience, not an authenticated identity.
4. Before sending, the browser encrypts a plaintext message using Web Crypto AES-GCM.
5. The server validates and stores only `ciphertext`, `iv`, and minimal message metadata.
6. Other browsers import the shared key from the invite link fragment and decrypt locally.
7. The random per-room key is shared through the full invite link. If the link leaks, anyone possessing it may decrypt messages.
8. Room expiration is counted from creation. Message retention expires individually after 5 minutes, even in longer rooms.
9. A server acknowledgment means it received a message; it doesn't prove recipients read it. Retry uses the same clientMessageId to limit duplicates.
10. Current state is in memory on one server. Multi-instance scaling needs coordinated room state; no extra infrastructure for now.

## Security caveats

- AES-GCM client-side encryption is implemented, but no external security audit has been done.
- Sharing the invite link shares decryption ability. Room metadata and usernames are not encrypted.
- Participant IDs are not secure accounts. Users with only the room ID may still attempt to occupy a slot.
- HTTPS protects transport. The static frontend remains trusted code; it could theoretically be changed by a compromised host.
- Avoid sending private credentials or other sensitive secrets.

## Deployment

- [x] Vercel frontend linked to `harshbarnawa/anochat`: https://anochat.vercel.app
- [ ] Persistent Node.js server deployment
- [ ] Vercel `VITE_API_URL` and `VITE_SOCKET_URL` and server `CLIENT_ORIGIN`
- [ ] Real production end-to-end chat verification

The live frontend alone cannot create rooms until backend deployment is finished.

## Original project

Read-only reference: https://github.com/h4dotai/h4chat

## Phase 1 history

## Architecture

Browser -> POST /api/rooms -> server creates in-memory room object.
Browser -> /room/:uuid -> Socket.IO connection -> room:join ack.
Browser -> message:send ack -> server validates membership and length -> room:state broadcast.
Every 5 seconds server removes expired rooms, prunes messages older than 5 minutes, and publishes refreshed room state so expired messages disappear from the UI.

**Meaning of durations:** Room expires 5/10/30 minutes after **creation**, whether users are still connected or not. Every message is retained at most 5 minutes, even inside a 30-minute room. Expiry is based on server time. The sweep is 5 seconds; old messages are filtered whenever room state is read.

**Disconnect behavior:** When a socket disconnects, its participant is removed once all their sockets disconnect. A reconnect can reuse the sessionStorage ID and reclaim the slot if available. If another user fills it first, rejoin can be rejected. Rooms remain until their selected deadline.

## Learning checklist

1. HTTP request/response is used to create rooms; WebSockets are used for bidirectional messages.
2. Socket.IO is a protocol/library layered over WebSocket or HTTP long-polling, not a raw WebSocket replacement at the wire level.
3. A room ID identifies a channel; a participant ID in sessionStorage helps rejoin, but is **not authentication**.
4. Always validate capacity and message payloads on the server: client checks are insufficient.
5. An acknowledgement means the server accepted a message, not that the second device read it.
6. React renders messages as text, not HTML, reducing XSS exposure. pre-wrap preserves newlines and spaces.
7. Message TTL and room lifetime are different timers.
8. In-memory state disappears on restart and cannot span horizontally scaled instances without shared storage and coordination.
9. Historical note: phase 1 was unencrypted; phase 2 added browser-side AES-GCM.

## Issues / production readiness

- The server needs a persistent host supporting Socket.IO. A static frontend host alone is not enough.
- No external encryption audit, message receipt, guaranteed delivery, or persistence across server restarts.
- Current reconnect identity is per-browser-tab, not an account. Socket disconnects briefly free the slot.
- No room-creation rate limiting yet; add before public launch.
- No multi-instance coordination (Redis adapter + shared room/session store) yet.
- Ensure deployment host names and VITE_API_URL/VITE_SOCKET_URL/CORS origins are configured.
- Build and tests require verification before calling this a working release.


