const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function encode(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid room key')
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function generateRoomKey() {
  const secret = new Uint8Array(32)
  crypto.getRandomValues(secret)
  return encode(secret)
}

export async function importRoomKey(fragment) {
  const match = /^#k=([A-Za-z0-9_-]{43})$/.exec(fragment)
  if (!match) throw new Error('Missing room key. Ask for the complete invite link.')
  const secret = decode(match[1])
  if (secret.length !== 32) throw new Error('Invalid room key')
  return crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptMessage(key, text) {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(text))
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}

export async function decryptMessage(key, message) {
  const iv = decode(message.iv)
  if (iv.length !== 12) throw new Error('Invalid IV')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, decode(message.ciphertext))
  return textDecoder.decode(plaintext)
}

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizeShortCode(value) {
  const normalized = typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : ''
  return /^[A-HJ-NP-Z2-9]{8}$/.test(normalized) ? normalized : null
}

export function generateShortCode() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => codeAlphabet[byte & 31]).join('')
}

export function generateRoomSalt() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return encode(bytes)
}

export async function hashShortCode(value) {
  const code = normalizeShortCode(value)
  if (!code) throw new Error('Enter a valid 8-character code')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(code)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function deriveRoomSecret(value, salt) {
  const code = normalizeShortCode(value)
  if (!code || typeof salt !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(salt)) {
    throw new Error('Invalid room code')
  }
  const material = await crypto.subtle.importKey('raw', textEncoder.encode(code), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: decode(salt), iterations: 180000
  }, material, 256)
  return encode(new Uint8Array(derived))
}
