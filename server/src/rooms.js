import { randomInt, randomUUID } from 'node:crypto'

export const DURATIONS = [5, 10, 30]
export const MESSAGE_TTL = 5 * 60 * 1000
export const MAX_CIPHERTEXT_LENGTH = 120000
const names = ['ghost', 'void', 'cipher', 'shadow', 'null', 'zero', 'pixel', 'echo', 'byte', 'nova']

export class RoomStore {
  constructor(now = () => Date.now()) {
    this.now = now
    this.rooms = new Map()
    this.codes = new Map()
  }

  create(duration = 5, maxParticipants = 4, codeHash = null, salt = null) {
    if (!DURATIONS.includes(duration)) throw new Error('Invalid duration')
    if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 10) {
      throw new Error('Choose between 2 and 10 people')
    }
    if (codeHash !== null || salt !== null) {
      if (typeof codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(codeHash) ||
          typeof salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(salt)) {
        throw new Error('Invalid room code metadata')
      }
      const existingId = this.codes.get(codeHash)
      if (existingId && this.get(existingId)) throw new Error('Code already in use')
    }
    const id = randomUUID()
    const createdAt = this.now()
    const room = {
      id, createdAt, expiresAt: createdAt + duration * 60000, duration, maxParticipants, codeHash, salt,
      participants: new Map(), messages: [], events: []
    }
    this.rooms.set(id, room)
    if (codeHash) this.codes.set(codeHash, id)
    return room
  }

  get(id) {
    const room = this.rooms.get(id)
    if (!room) return null
    if (room.expiresAt <= this.now()) {
      this.rooms.delete(id)
      if (room.codeHash) this.codes.delete(room.codeHash)
      return null
    }
    this.pruneMessages(room)
    return room
  }

  findByCodeHash(codeHash) {
    if (typeof codeHash !== 'string' || !/^[a-f0-9]{64}$/.test(codeHash)) return null
    const roomId = this.codes.get(codeHash)
    return roomId ? this.get(roomId) : null
  }

  pruneMessages(room) {
    room.messages = room.messages.filter(message => message.createdAt + MESSAGE_TTL > this.now())
    room.events = room.events.filter(event => event.createdAt + MESSAGE_TTL > this.now())
  }

  recordEvent(room, kind, name) {
    room.events.push({ id: randomUUID(), kind, name, createdAt: this.now() })
    if (room.events.length > 100) room.events.shift()
  }

  join(id, participantId, socketId) {
    const room = this.get(id)
    if (!room) return { error: 'Room not found or expired' }
    if (typeof participantId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(participantId)) {
      return { error: 'Invalid participant' }
    }
    let participant = room.participants.get(participantId)
    if (!participant && room.participants.size >= room.maxParticipants) {
      return { error: 'Room is full (' + room.maxParticipants + '/' + room.maxParticipants + ')' }
    }
    if (!participant) {
      const used = new Set([...room.participants.values()].map(value => value.name))
      const unused = names.filter(name => !used.has(name))
      participant = { id: participantId, name: unused[randomInt(unused.length)], sockets: new Set() }
      room.participants.set(participantId, participant)
      this.recordEvent(room, 'joined', participant.name)
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
    if (participant.sockets.size === 0) {
      room.participants.delete(participantId)
      this.recordEvent(room, 'left', participant.name)
    }
    return room
  }

  addMessage(id, participantId, data) {
    const room = this.get(id)
    if (!room) return { error: 'Room expired' }
    const participant = room.participants.get(participantId)
    if (!participant || participant.sockets.size === 0) return { error: 'Join the room first' }
    if (!data || typeof data !== 'object' ||
        typeof data.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(data.iv) ||
        typeof data.ciphertext !== 'string' ||
        data.ciphertext.length < 22 || data.ciphertext.length > MAX_CIPHERTEXT_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(data.ciphertext) ||
        typeof data.clientMessageId !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(data.clientMessageId)) {
      return { error: 'Invalid encrypted message' }
    }
    const existing = room.messages.find(message =>
      message.participantId === participantId && message.clientMessageId === data.clientMessageId
    )
    if (existing) return { message: existing, room, duplicate: true }
    const message = {
      id: randomUUID(), clientMessageId: data.clientMessageId,
      participantId, name: participant.name, iv: data.iv, ciphertext: data.ciphertext,
      createdAt: this.now()
    }
    room.messages.push(message)
    return { message, room, duplicate: false }
  }

  snapshot(room) {
    this.pruneMessages(room)
    return {
      id: room.id, expiresAt: room.expiresAt, duration: room.duration, maxParticipants: room.maxParticipants,
      participants: [...room.participants.values()].map(({ id, name }) => ({ id, name })),
      messages: room.messages,
      events: room.events
    }
  }

  cleanup() {
    const expired = []
    for (const [id, room] of this.rooms) {
      if (room.expiresAt <= this.now()) {
        expired.push(id)
        this.rooms.delete(id)
        if (room.codeHash) this.codes.delete(room.codeHash)
      } else {
        this.pruneMessages(room)
      }
    }
    return expired
  }
}
