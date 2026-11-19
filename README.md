# anochat

Anonymous, temporary real-time chat for messages and formatted code. No accounts, login, or permanent message history.

A JavaScript rebuild of the earlier [h4chat](https://github.com/h4dotai/h4chat) learning project.

## Run locally

Install Node.js 20.19+ and npm.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Frontend Vite proxies API and Socket.IO to the Node server on port 4000.

```bash
npm test
npm run build
```

## Behavior

- Select a 5, 10, or 30 minute room life when creating a room.
- Share the link with one other person. Maximum two anonymous participants.
- Messages vanish from server memory after 5 minutes, independent of room life.
- Paste code with spaces, indentation, tabs and newlines preserved.
- **Enter** inserts a newline, **Ctrl/Cmd+Enter** sends, **Tab** indents.
- Socket.IO reconnects automatically and attempts to rejoin after interruptions.
- In-memory rooms are erased when expired or when the server restarts.

This first implementation is **not end-to-end encrypted** and is **not production-hardened**. Do not send credentials or secrets. Read [progress.md](./progress.md) for current status, architectural notes, test checklist and next improvements.

## Deployment environment

Server: `PORT` (default 4000), `CLIENT_ORIGIN` (comma-separated allowed browser origins).

Client build: `VITE_API_URL` (public API base URL), `VITE_SOCKET_URL` (Socket.IO server base URL).

Deploy the server to a long-running WebSocket-capable host, then the static Vite client to a frontend host. Configure CORS origin(s) to your frontend URL.
