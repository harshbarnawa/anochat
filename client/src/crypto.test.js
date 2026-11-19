import test from 'node:test'
import assert from 'node:assert/strict'
import { generateRoomKey, importRoomKey, encryptMessage, decryptMessage } from './crypto.js'


test('two browsers using shared room key decrypt identical text and code', async () => {
  const secret = generateRoomKey()
  assert.equal(secret.length, 43)
  const alice = await importRoomKey('#k=' + secret)
  const bob = await importRoomKey('#k=' + secret)
  const code = 'function hello() {\n\t  console.log("hello")\n}\n\nhello()'
  const encrypted = await encryptMessage(alice, code)
  assert.notEqual(encrypted.ciphertext, code)
  assert.equal(await decryptMessage(bob, encrypted), code)
})

test('encryption uses new IV and wrong room key cannot decrypt', async () => {
  const first = await importRoomKey('#k=' + generateRoomKey())
  const second = await importRoomKey('#k=' + generateRoomKey())
  const a = await encryptMessage(first, 'private')
  const b = await encryptMessage(first, 'private')
  assert.notEqual(a.iv, b.iv)
  assert.notEqual(a.ciphertext, b.ciphertext)
  await assert.rejects(decryptMessage(second, a))
})

test('missing and malformed invite key are rejected', async () => {
  await assert.rejects(importRoomKey(''))
  await assert.rejects(importRoomKey('#k=bad'))
})

test('eight-character short codes reproduce the same AES key and link key', async () => {
  const { generateShortCode, generateRoomSalt, normalizeShortCode, hashShortCode, deriveRoomSecret } = await import('./crypto.js')
  const code = generateShortCode()
  const salt = generateRoomSalt()
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.equal(normalizeShortCode(code.toLowerCase()), code)
  assert.equal(normalizeShortCode('bad'), null)
  assert.equal(salt.length, 22)
  const digest = await hashShortCode(code)
  assert.match(digest, /^[a-f0-9]{64}$/)
  assert.equal(await hashShortCode(code.toLowerCase()), digest)
  const roomKey = await deriveRoomSecret(code, salt)
  const roomKeyFromJoin = await deriveRoomSecret(code.toLowerCase(), salt)
  assert.equal(roomKey.length, 43)
  assert.equal(roomKey, roomKeyFromJoin)
  const alice = await importRoomKey('#k=' + roomKey)
  const bob = await importRoomKey('#k=' + roomKeyFromJoin)
  const original = 'void main() {\n    return;\n}'
  const encrypted = await encryptMessage(alice, original)
  assert.equal(await decryptMessage(bob, encrypted), original)
  await assert.rejects(deriveRoomSecret(generateShortCode(), 'bad'))
})

test('different short codes and different salts produce different room keys', async () => {
  const { generateRoomSalt, deriveRoomSecret } = await import('./crypto.js')
  const salt = generateRoomSalt()
  const first = await deriveRoomSecret('ABCD2345', salt)
  const second = await deriveRoomSecret('ABCD2346', salt)
  const third = await deriveRoomSecret('ABCD2345', generateRoomSalt())
  assert.notEqual(first, second)
  assert.notEqual(first, third)
})
