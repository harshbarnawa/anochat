import http from 'node:http'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { RoomStore } from './rooms.js'

const app = express()
const server = http.createServer(app)
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim())
const io = new Server(server, { cors: { origin: origins, methods: ['GET', 'POST'] }, maxHttpBufferSize: 160000 })
const store = new RoomStore()
const active = new Map()

app.use(cors({ origin: origins }))
app.use(express.json({ limit: '10kb' }))
app.disable('x-powered-by')

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.post('/api/rooms', (req, res) => {
  const duration = req.body?.duration ?? 5
  const maxParticipants = req.body?.maxParticipants ?? 4
  try {
    const room = store.create(duration, maxParticipants)
    res.status(201).json({
      id: room.id, expiresAt: room.expiresAt, duration: room.duration,
      maxParticipants: room.maxParticipants
    })
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})
app.get('/api/rooms/:id', (req, res) => {
  const room = store.get(req.params.id)
  if (!room) return res.status(404).json({ error: 'Room not found or expired' })
  res.json({ id: room.id, expiresAt: room.expiresAt, duration: room.duration, maxParticipants: room.maxParticipants })
})

function publish(room) {
  io.to(room.id).emit('room:state', store.snapshot(room))
}

io.on('connection', socket => {
  socket.on('room:join', (data, ack) => {
    if (typeof ack !== 'function') return
    if (!data || typeof data.roomId !== 'string') return ack({ ok: false, error: 'Invalid room' })
    const previous = active.get(socket.id)
    if (previous && (previous.roomId !== data.roomId || previous.participantId !== data.participantId)) {
      socket.leave(previous.roomId)
      const oldRoom = store.leave(previous.roomId, previous.participantId, socket.id)
      active.delete(socket.id)
      if (oldRoom) publish(oldRoom)
    }
    const result = store.join(data.roomId, data.participantId, socket.id)
    if (result.error) return ack({ ok: false, error: result.error })
    active.set(socket.id, { roomId: data.roomId, participantId: data.participantId })
    socket.join(data.roomId)
    ack({ ok: true, participantId: data.participantId, name: result.participant.name, state: store.snapshot(result.room) })
    publish(result.room)
  })

  socket.on('message:send', (data, ack) => {
    if (typeof ack !== 'function') return
    const session = active.get(socket.id)
    if (!session) return ack({ ok: false, error: 'Not connected to a room' })
    const result = store.addMessage(session.roomId, session.participantId, data)
    if (result.error) return ack({ ok: false, error: result.error })
    ack({ ok: true, id: result.message.id })
    if (!result.duplicate) publish(result.room)
  })

  socket.on('disconnect', () => {
    const session = active.get(socket.id)
    if (!session) return
    active.delete(socket.id)
    const room = store.leave(session.roomId, session.participantId, socket.id)
    if (room) publish(room)
  })
})

setInterval(() => {
  for (const id of store.cleanup()) {
    io.to(id).emit('room:expired')
    for (const [socketId, session] of active) {
      if (session.roomId === id) {
        active.delete(socketId)
        io.sockets.sockets.get(socketId)?.disconnect(true)
      }
    }
  }
  for (const room of store.rooms.values()) publish(room)
}, 5000).unref()

const port = Number(process.env.PORT || 4000)
server.listen(port, () => console.log('anochat server listening on :' + port))
