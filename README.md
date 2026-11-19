# anochat

Temporary, anonymous group chat for sharing messages and formatted code between devices. No accounts.

**Live frontend:** https://anochat.vercel.app

## Rooms

- Default duration: **5 minutes**, choose 5 / 10 / 30 minutes.
- Default people limit: **4**, choose any number from **2 to 10**.
- Create a room to get **both** a full invite link and a short 8-character code. Both join the same room.
- Enter the code on the single chat screen to join without pasting a long URL. Code entry disappears once connected.
- The short code is displayed with a Copy Code button for the creator and anyone who joined using the code. Link-only joiners can still copy the full invite URL.
- All participants share the same chat, like a temporary group conversation. Join/leave events are displayed for five minutes.
- Messages remain for at most 5 minutes; the room closes when its chosen duration ends.
- Pasting and copying code preserves whitespace, tabs, indentation and line breaks. The editor auto-grows and only scrolls internally for long messages.
- Enter sends; Shift+Enter inserts a new line; Tab inserts two spaces. Messages can also be sent with the button.

## Encryption

Browsers encrypt and decrypt messages with **AES-256-GCM**. For newly created short-code rooms, the browser derives a 256-bit AES key from the 8-character room code and a random salt using PBKDF2-SHA-256 (180,000 iterations). The full invite URL contains the derived key after `#k=`. The backend stores only the code's SHA-256 lookup hash, salt, and encrypted message payloads; it does not receive the code or plaintext message key directly. Existing full-link-only rooms remain compatible.

**Security trade-off:** An 8-character code is convenient but has only about 40 bits of search space, not 256 bits of independent secret entropy. A malicious server or someone with its code hashes may be able to try guesses offline. Requests to look up codes are rate-limited, but that does not solve offline attacks. Anyone with the link or code can access the room if space remains, and can derive the message key. This is a short-lived learning/utility app, **not an independently audited secure messenger**. Do not send passwords or sensitive secrets.

## Start for development

Node.js 20.19+ or 22+:

```bash
npm install
npm run dev
npm test
npm run build
```

Open http://localhost:5173. The Vite client proxies backend requests to Node.js port 4000.

## Deployment

Vercel serves the frontend at https://anochat.vercel.app and Render serves the persistent Socket.IO/Express backend at https://anochat-api.onrender.com. The app uses one responsive chat screen: before room creation its message composer is disabled, and room options appear within the chat screen.

Backend environment:
- `PORT` — server port, defaults to 4000
- `CLIENT_ORIGIN` — allowed frontend origin(s), e.g. `https://anochat.vercel.app`

Vercel client build environment:
- `VITE_API_URL` — public backend base URL
- `VITE_SOCKET_URL` — public backend Socket.IO URL (usually same as API)

Rooms and messages exist in the memory of one Node server and vanish after the configured expiry or server restart. Render free hosting may sleep when inactive, which can delay first connections. The project is not horizontally scalable yet. See [progress.md](./progress.md) for implementation and testing notes.
