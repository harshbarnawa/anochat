# anochat

Temporary, anonymous group chat for sharing messages and formatted code between devices. No accounts.

**Live frontend:** https://anochat.vercel.app

## Rooms

- Default duration: **5 minutes**, choose 5 / 10 / 30 minutes.
- Default people limit: **4**, choose any number from **2 to 10**.
- The invite URL gives access to the room. Share it only with the people you want to join.
- All participants share the same chat, like a temporary group conversation.
- Messages remain for at most 5 minutes; the room closes when its chosen duration ends.
- Pasting and copying code preserves whitespace, tabs, indentation and line breaks.
- Enter adds a new line; Ctrl/Cmd+Enter sends; Tab inserts two spaces.

## Encryption

Browsers encrypt and decrypt messages using a shared random **256-bit AES-GCM room key**, embedded after `#k=` in the invite link. URL fragments are not sent in normal HTTP requests. The Node.js server stores and broadcasts **ciphertext and IV only**. The room key is never sent to the server by this app.

This is a lightweight browser-side encrypted learning project, **not an independently audited messenger**. Anyone with the full invite link can decrypt messages; sharing the link shares the key. There is no user identity verification, group membership is not cryptographically authenticated, and browsers still trust the served client code. Do not use it for sensitive secrets.

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
