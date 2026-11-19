import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { generateRoomKey, importRoomKey, encryptMessage, decryptMessage } from './crypto.js'

globalThis.crypto = webcrypto

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
