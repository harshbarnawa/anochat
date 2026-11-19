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
- [x] Copied code keeps spaces, tabs and line breaks; Enter sends, Shift+Enter inserts newline
- [x] Retry-safe client message IDs and server duplicate suppression in active message history
- [x] Added group-capacity tests and encryption round-trip/wrong-key tests
- [x] GitHub Actions Node 22: server unit tests, client AES-GCM tests and Vite build passed (commit a4b338f)
- [x] Render service `anochat-api` live with Node.js/Socket.IO; Vercel API and Socket.IO environment variables configured
- [x] User-confirmed live chat in three browser sessions, including formatted code transfer
- [ ] Separate phone, network interruption, capacity and expiry edge-case checks

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
- [x] Persistent Node.js server deployed to Render, service `anochat-api` (free tier)
- [x] Vercel `VITE_API_URL`, `VITE_SOCKET_URL` and Render server `CLIENT_ORIGIN` configured
- [x] User-confirmed real-time messages across three live browsers
- [ ] Full phone/network/reconnect smoke check

Frontend and backend are linked. Render/Vercel and CI passed. Three-browser production messaging was confirmed by the user.

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



## Phase 3 — single-page app and deployment (2026-11-19)

- [x] Render free web service: `anochat-api`, Singapore, Node.js  server, GitHub main auto-deploy
- [x] Server reports LIVE in Render and logs show `anochat server listening on :10000`
- [x] Frontend env vars point to `https://anochat-api.onrender.com`; Render CORS allows `https://anochat.vercel.app`
- [x] Replaced separate home screen with one chat screen: inline create-room options and disabled composer until connected
- [x] Enter sends, Shift+Enter adds newline, Tab inserts spaces; mobile has Send button
- [x] Mobile viewport and safe-area spacing refined for narrow devices
- [x] GitHub Actions unit/encryption tests and production Vite build passing (commit `669284f`)
- [x] Vercel frontend READY for commit `669284f`
- [x] User-confirmed live multi-browser room creation and message relay

Known limits: Render free services can cold-start; in-memory rooms disappear if server restarts; no public claim of security audit. No additional UI features until actual live messaging is tested.

## Phase 4 — join/leave logs and expanding composer (2026-11-19)

- [x] Added server-generated anonymous join/leave activity events alongside encrypted messages in the chat timeline.
- [x] Activity logs use muted text and disappear after the five-minute retention window.
- [x] Joining twice from the same participant does not duplicate join logs, and leaving the last socket writes a leave log.
- [x] Composer starts at one line and expands while typing (capped at 200px / mobile viewport), then scrolls internally.
- [x] Enter sends, Shift+Enter adds newline, Tab inserts spaces.
- [x] Added unit tests for activity log semantics and expiry.
- [x] GitHub Actions server tests, encryption tests and Vite build passed for code commit `4d11cf1`.
- [x] Vercel production deployment READY and Render service LIVE for code commit `4d11cf1`.
- [x] User confirmed join logs and message delivery in three simultaneous browser sessions; auto-grow/scroll polish released afterward.

User confirmed live two-browser encrypted chat and code-formatting transfer before these changes. Activity logs contain public room metadata (names and timestamps), not plaintext messages.

## Phase 5 — small v1 finishing fixes (2026-11-19)

- [x] User verified the live app across **three browsers**: room joining, message sync, anonymous join logs and code transfer work.
- [x] Fixed unnecessary textarea scrollbar for short drafts. Composer now grows until a capped height and scrolls internally only for longer drafts.
- [x] Use dynamic viewport height on mobile, 16px input font to avoid iOS focus zoom, and disable keyboard autocorrect/spellcheck for pasted code.
- [x] Repeated join requests on the same socket/participant no longer generate fake leave/join events.
- [x] Retry a room join after a Socket.IO acknowledgement timeout without requiring a page refresh. Room-not-found responses are treated as expired.
- [x] Show brief copied feedback on message copy button.
- [x] Existing encryption, temporary retention, room defaults and minimal single-screen design preserved.
- [x] Commit `ad92dac`: CI tests/build passed, Vercel production READY, Render server LIVE.
- [ ] Real phone keyboard and disconnect/reconnect smoke checks remain user-device tests; these are not claimed as verified by automated builds.

## Phase 6 — short invite codes (2026-11-19)

- [x] New rooms generate an 8-character human-readable uppercase code (32-symbol alphabet, avoiding ambiguous I/O/0/1).
- [x] Existing full invite URL continues working and contains the same browser-derived AES-GCM key.
- [x] Added code input + Join action to the existing single chat screen; both disappear after joining.
- [x] Show code as read-only text with a Copy Code button while in a room, if this browser knows the code.
- [x] Server holds SHA-256(code) to resolve an active room and its random salt, with per-IP short-code lookup rate limiting.
- [x] Browser derives the AES-256-GCM key with PBKDF2-SHA-256 (180k iterations) and the room salt, so server does not directly receive raw code or message key.
- [x] Old invite links with their existing 256-bit key still work while those rooms remain alive.
- [x] Code index is removed on room expiration; join is rejected after expiry.
- [x] Added unit tests for code lookup, collision/expiry, code normalization and encrypted message round-trip.
- [x] GitHub Actions server tests, browser-side encryption tests and Vite production build passed for commit `4fc5726`.
- [x] Vercel production deployment READY and Render API deployment LIVE for commit `4fc5726`.
- [ ] Manually verify cross-browser joining by the short code and by full link (not yet user-confirmed).

Security note: Eight-character code = approximately 40 bits of entropy, not equivalent to a truly random 256-bit invite secret. A server with code hashes can attempt offline guessing. Short codes are intended only for temporary convenience and are not appropriate for high-sensitivity communications.

Code visibility: the room creator and people who joined by a short code can see/copy that code in the current browser; someone who only has the full URL can use Copy Link, but cannot reconstruct the code from the derived encryption key.
