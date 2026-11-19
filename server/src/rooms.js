import { randomUUID } from 'node:crypto'

export const DURATIONS = [5, 10, 30]
export const MESSAGE_TTL = 5 * 60 * 1000
export const MAX_MESSAGE_LENGTH = 20000
const names = ['ghost', 'void', 'cipher', 'shadow', 'null', 'zero', 'pixel', 'echo', 'byte', 'nova']

export class RoomStore {
  constructor(now = () => Date.now()) {
    this.now = now
    this.rooms = new Map()
  }

  create(duration) {
    if (!DURATIONS.includes(duration)) throw new Error('Invalid duration')
    const id = randomUUID()
    const createdAt = this.now()
    const room = { id, createdAt, expiresAt: createdAt + duration * 60000, duration, participants: new Map(), messages: [] }
    this.rooms.set(id, room)
    return room
  }

  get(id) {
    const room = this.rooms.get(id)
    if (!room) return null
    if (room.expiresAt <= this.now()) {
      this.rooms.delete(id)
      return null
    }
    this.pruneMessages(room)
    return room
  }

  pruneMessages(room) {
    room.messages = room.messages.filter(message => message.createdAt + MESSAGE_TTL > this.now())
  }

  join(id, participantId, socketId) {
    const room = this.get(id)
    if (!room) return { error: 'Room not found or expired' }
    if (typeof participantId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(participantId)) {
      return { error: 'Invalid participant ID' }
    }
    let participant = room.participants.get(participantId)
    if (!participant && room.participants.size >= 2) return { error: 'This room is full (2/2)' }
    if (!participant) {
      const used = new Set([...room.participants.values()].map(item => item.name))
      const available = names.filter(name => !used.has(name))
      const name = available[Math.floor(Math.random() * available.length)]
      participant = { id: participantId, name, sockets: new Set() }
      room.participants.set(participantId, participant)
    }
    participant.sockets.add(socketId)
    return { room, participant }
  }

  leave(id, participantId, socketId) {
    const room = this.get(id)
    if (!room) return null
    const participant = room.participants.get(participantId)
    if (!participant) return room
    participant.sockets.delete(socketId)
    if (participant.sockets.size === 0) room.participants.delete(participantId)
    return room
  }

  addMessage(id, participantId, text) {
    const room = this.get(id)
    if (!room) return { error: 'Room expired' }
    const participant = room.participants.get(participantId)
    if (!participant || participant.sockets.size === 0) return { error: 'Join the room first' }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
      return { error: 'Message must contain 1–20000 characters' }
    }
    const message = { id: randomUUID(), participantId, name: participant.name, text, createdAt: this.now() }
    room.messages.push(message)
    return { message, room }
  }

  snapshot(room) {
    this.pruneMessages(room)
    return {
      id: room.id,
      expiresAt: room.expiresAt,
      duration: room.duration,
      participants: [...room.participants.values()].map(({ id, name }) => ({ id, name })),
      messages: room.messages
    }
  }

  cleanup() {
    const expired = []
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= this.now()) {
        expired.push(id)
        this.rooms.delete(id)
      } else {
        this.pruneMessages(room)
      }
    }
    return expired
  }
}
