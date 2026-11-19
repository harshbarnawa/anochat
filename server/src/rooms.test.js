import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomStore, MESSAGE_TTL } from './rooms.js'

const participant = i => 'participant-' + String(i).padStart(3, '0')
const payload = (id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') => ({
  iv: 'abcdefghijklmnop', ciphertext: 'abcdefghijklmnopqrstuvwxyz123456',
  clientMessageId: id
})

test('defaults to five minutes and four people; validates limits', () => {
  const store = new RoomStore()
  const room = store.create()
  assert.equal(room.duration, 5)
  assert.equal(room.maxParticipants, 4)
  assert.throws(() => store.create(60, 4))
  assert.throws(() => store.create(5, 1))
  assert.throws(() => store.create(5, 11))
  assert.equal(store.create(10, 10).maxParticipants, 10)
  assert.equal(store.create(30, 2).maxParticipants, 2)
})

test('default room allows four, refuses fifth', () => {
  const store = new RoomStore()
  const room = store.create()
  for (let i = 0; i < 4; i++) assert.ok(store.join(room.id, participant(i), 'socket-' + i).room)
  assert.match(store.join(room.id, participant(5), 'socket-5').error, /full/)
  assert.equal(new Set([...room.participants.values()].map(value => value.name)).size, 4)
})

test('configurable room for two rejects third, room for ten admits ten', () => {
  const store = new RoomStore()
  const small = store.create(5, 2)
  store.join(small.id, participant(1), 'a')
  store.join(small.id, participant(2), 'b')
  assert.ok(store.join(small.id, participant(3), 'c').error)
  const large = store.create(5, 10)
  for (let i = 0; i < 10; i++) assert.ok(store.join(large.id, participant(i), 'socket-' + i).room)
  assert.equal(store.get(large.id).participants.size, 10)
})

test('same participant may reconnect and does not consume another slot', () => {
  const store = new RoomStore()
  const room = store.create(5, 2)
  store.join(room.id, participant(1), 'socket-a')
  store.join(room.id, participant(1), 'socket-b')
  assert.equal(room.participants.size, 1)
  store.leave(room.id, participant(1), 'socket-a')
  assert.equal(room.participants.size, 1)
  store.leave(room.id, participant(1), 'socket-b')
  assert.equal(room.participants.size, 0)
})

test('server stores ciphertext only and deduplicates acknowledged retries', () => {
  const store = new RoomStore()
  const room = store.create()
  assert.ok(store.addMessage(room.id, participant(1), payload()).error)
  store.join(room.id, participant(1), 'socket-a')
  assert.ok(store.addMessage(room.id, participant(1), { text: 'plaintext' }).error)
  const first = store.addMessage(room.id, participant(1), payload())
  assert.equal(first.message.ciphertext, payload().ciphertext)
  assert.equal(first.message.text, undefined)
  const second = store.addMessage(room.id, participant(1), payload())
  assert.equal(second.duplicate, true)
  assert.equal(room.messages.length, 1)
})

test('message history expires after five minutes even in longer room', () => {
  let now = 0
  const store = new RoomStore(() => now)
  const room = store.create(10, 4)
  store.join(room.id, participant(1), 'socket-a')
  store.addMessage(room.id, participant(1), payload())
  now = MESSAGE_TTL + 1
  assert.equal(store.snapshot(store.get(room.id)).messages.length, 0)
  assert.ok(store.get(room.id))
  now = 10 * 60000
  assert.equal(store.get(room.id), null)
})

test('join and leave logs appear once per participant, not per socket', () => {
  const store = new RoomStore()
  const room = store.create(10)
  const first = store.join(room.id, participant(1), 'socket-a').participant.name
  const second = store.join(room.id, participant(2), 'socket-b').participant.name
  store.join(room.id, participant(1), 'socket-c')
  assert.deepEqual(store.snapshot(room).events.map(event => [event.kind, event.name]), [
    ['joined', first], ['joined', second]
  ])
  store.leave(room.id, participant(1), 'socket-a')
  assert.equal(store.snapshot(room).events.length, 2)
  store.leave(room.id, participant(1), 'socket-c')
  assert.deepEqual(store.snapshot(room).events.at(-1).kind, 'left')
  assert.equal(store.snapshot(room).events.at(-1).name, first)
  store.leave(room.id, participant(1), 'socket-c')
  assert.equal(store.snapshot(room).events.length, 3)
})

test('join and leave logs expire with the five-minute history window', () => {
  let now = 0
  const store = new RoomStore(() => now)
  const room = store.create(10)
  store.join(room.id, participant(1), 'socket-a')
  store.leave(room.id, participant(1), 'socket-a')
  assert.equal(store.snapshot(room).events.length, 2)
  now = MESSAGE_TTL + 1
  assert.equal(store.snapshot(store.get(room.id)).events.length, 0)
  assert.ok(store.get(room.id))
})
