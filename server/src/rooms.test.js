import test from 'node:test'
import assert from 'node:assert/strict'
import { RoomStore, MESSAGE_TTL } from './rooms.js'

test('room duration must be 5, 10 or 30 minutes', () => {
  const store = new RoomStore()
  assert.throws(() => store.create(60))
  assert.equal(store.create(10).duration, 10)
})

test('two different participants may join, third is rejected', () => {
  const store = new RoomStore()
  const room = store.create(5)
  assert.ok(store.join(room.id, 'participant-111', 'socket-a').room)
  assert.ok(store.join(room.id, 'participant-222', 'socket-b').room)
  assert.match(store.join(room.id, 'participant-333', 'socket-c').error, /full/)
})

test('same participant can reconnect without occupying another slot', () => {
  const store = new RoomStore()
  const room = store.create(5)
  store.join(room.id, 'participant-111', 'socket-a')
  store.join(room.id, 'participant-111', 'socket-b')
  assert.equal(store.get(room.id).participants.size, 1)
  store.leave(room.id, 'participant-111', 'socket-a')
  assert.equal(store.get(room.id).participants.size, 1)
  store.leave(room.id, 'participant-111', 'socket-b')
  assert.equal(store.get(room.id).participants.size, 0)
})

test('preserves code whitespace and only accepts joined user messages', () => {
  const store = new RoomStore()
  const room = store.create(5)
  const text = 'function test() {\n\t  return 42\n}\n'
  assert.ok(store.addMessage(room.id, 'participant-111', text).error)
  store.join(room.id, 'participant-111', 'socket-a')
  assert.equal(store.addMessage(room.id, 'participant-111', text).message.text, text)
})

test('message history expires after five minutes independently of room', () => {
  let time = 0
  const store = new RoomStore(() => time)
  const room = store.create(10)
  store.join(room.id, 'participant-111', 'socket-a')
  store.addMessage(room.id, 'participant-111', 'test')
  time = MESSAGE_TTL + 1
  assert.equal(store.snapshot(store.get(room.id)).messages.length, 0)
  assert.ok(store.get(room.id))
  time = 10 * 60000
  assert.equal(store.get(room.id), null)
})
