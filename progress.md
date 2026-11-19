# anochat — build progress and learning notes

Last updated: 2026-11-19

## Goal

Rebuild h4chat as **anochat**, a no-login anonymous real-time app optimized for quickly sending text and formatted code between phones and computers using a temporary room link. Preserve the sparse dark terminal aesthetic, but make connections and delivery more reliable.

Original reference: https://github.com/h4dotai/h4chat

## Phase 1 — initial implementation (CI checks passing; real-device testing pending)

- [x] Repository scaffolding: JavaScript monorepo, React/Vite client, Express/Socket.IO server
- [x] Minimal black, monospace terminal-inspired homepage and chat layout
- [x] Create shareable UUID room from UI through a server endpoint
- [x] User-selectable absolute room lifetime of 5, 10, or 30 minutes
- [x] Maximum two *distinct participant IDs* in each room
- [x] Random anonymous names such as ghost, echo and cipher
- [x] Real-time message transmission with acknowledgement and errors
- [x] Socket.IO automatic reconnect and rejoin using sessionStorage participant ID
- [x] 5-minute message TTL, independent of the room lifetime, plus expiry sweep
- [x] Multiline editor: Enter newline, Ctrl/Cmd+Enter send, Tab inserts two spaces
- [x] Plain text message display using pre-wrap and copy button to preserve indentation
- [x] Room expiration countdown, users sidebar, link-copy, phone-responsive styles
- [x] RoomStore unit tests (written, not yet run in this environment)
- [x] GitHub Actions executed npm install, server unit tests, and frontend production build successfully (2026-11-19)
- [ ] Real two-device smoke test on deployed instances
- [ ] Verify deploys and check WebSocket behavior on production hosts
- [ ] Add integration tests for Socket.IO reconnect, ordering, and multiple tabs
- [x] GitHub Actions workflow running tests and build on push/PR (passing on commit b053823)

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
9. No end-to-end encryption is claimed; room URLs are bearer access links and sharing them grants access if a slot is open.

## Issues / production readiness

- The server needs a persistent host supporting Socket.IO. A static frontend host alone is not enough.
- No true E2EE, message receipt, guaranteed delivery, or persistence across server restarts.
- Current reconnect identity is per-browser-tab, not an account. Socket disconnects briefly free the slot.
- No room-creation rate limiting yet; add before public launch.
- No multi-instance coordination (Redis adapter + shared room/session store) yet.
- Ensure deployment host names and VITE_API_URL/VITE_SOCKET_URL/CORS origins are configured.
- Build and tests require verification before calling this a working release.

## How to run

Install Node.js 20.19+.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Run `npm test` and `npm run build` separately.

## Future engineering exercises

- Integration tests with two clients and a third rejected client
- Message delivery test with intentional network interruption
- Retry-safe message client IDs and de-duplication, delivered/read receipts
- Reconnect grace period vs strict two-user slot safety
- Paste-size limits, syntax-highlighted code blocks, copy-feedback
- Request throttling, connection limits, security review
- Redis state + horizontal scaling and load-test results

## Deployment progress — 2026-11-19

- [x] Vercel project `anochat` created and connected to GitHub `harshbarnawa/anochat` main branch.
- [x] Production frontend is READY at https://anochat.vercel.app (Vite build, commit 62296bb).
- [x] Added client/vercel.json to serve `/room/:id` routes through the SPA.
- [ ] Deploy persistent Socket.IO backend (not supported by the static Vercel frontend alone).
- [ ] Set VITE_API_URL and VITE_SOCKET_URL in Vercel and CLIENT_ORIGIN on backend, then redeploy frontend.
- [ ] Verify create-room and two-device chat end to end after backend deployment.

Current live site is **frontend-only**: API `/api/rooms` is not connected to a live server, so Create Room will fail until the backend is online. Keep implementation focused; no optional features during deployment.
