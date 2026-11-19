import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { decryptMessage, encryptMessage, importRoomKey, generateShortCode, generateRoomSalt, hashShortCode, deriveRoomSecret, normalizeShortCode } from './crypto.js'

const api = import.meta.env.VITE_API_URL || ''
const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin

function getParticipantId(roomId) {
  const key = 'anochat:' + roomId
  let value = sessionStorage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    sessionStorage.setItem(key, value)
  }
  return value
}

function roomFromPath() {
  const match = window.location.pathname.match(/^\/room\/([0-9a-f-]{36})\/?$/i)
  return match?.[1] || null
}

function fitComposer(field) {
  if (!field) return
  field.style.height = 'auto'
  const viewport = window.visualViewport?.height || window.innerHeight
  const limit = Math.max(42, Math.min(200, Math.floor(viewport * 0.38)))
  const height = Math.max(42, field.scrollHeight + 2)
  field.style.height = Math.min(height, limit) + 'px'
  field.style.overflowY = height > limit ? 'auto' : 'hidden'
}

function App() {
  const [roomId, setRoomId] = useState(roomFromPath)
  const [duration, setDuration] = useState(5)
  const [maxParticipants, setMaxParticipants] = useState(4)
  const [creating, setCreating] = useState(false)
  const [enterCode, setEnterCode] = useState('')
  const [joiningByCode, setJoiningByCode] = useState(false)
  const [roomCode, setRoomCode] = useState(() => {
    const id = roomFromPath()
    return id ? sessionStorage.getItem('anochat:code:' + id) : null
  })
  const [key, setKey] = useState(null)
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [messages, setMessages] = useState([])
  const [seconds, setSeconds] = useState(0)
  const [copied, setCopied] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState(null)
  const [sending, setSending] = useState(false)
  const socketRef = useRef(null)
  const composerRef = useRef(null)
  const scrollRef = useRef(null)
  const pendingRef = useRef(null)
  const cacheRef = useRef(new Map())
  const participantIdRef = useRef(roomId ? getParticipantId(roomId) : null)

  useEffect(() => {
    const onPopState = () => {
      const next = roomFromPath()
      setRoomId(next)
      setRoomCode(next ? sessionStorage.getItem('anochat:code:' + next) : null)
      participantIdRef.current = next ? getParticipantId(next) : null
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    setKey(null)
    setState(null)
    setMessages([])
    cacheRef.current.clear()
    pendingRef.current = null
    setError('')
    if (!roomId) {
      setStatus('idle')
      return
    }
    let active = true
    setStatus('connecting')
    importRoomKey(window.location.hash)
      .then(value => { if (active) setKey(value) })
      .catch(err => { if (active) { setStatus('error'); setError(err.message) } })
    return () => { active = false }
  }, [roomId])

  useEffect(() => {
    if (!roomId || !key) return
    const socket = io(socketUrl, { reconnection: true, transports: ['websocket', 'polling'] })
    socketRef.current = socket

    let retryTimer
    let stopped = false

    function join() {
      if (stopped || !socket.connected) return
      clearTimeout(retryTimer)
      setStatus('connecting')
      socket.timeout(10000).emit('room:join', { roomId, participantId: participantIdRef.current }, (err, result) => {
        if (stopped || !socket.connected) return
        if (err) {
          setStatus('disconnected')
          setError('Connection timed out. Retrying...')
          retryTimer = setTimeout(join, 2500)
          return
        }
        if (!result?.ok) {
          setStatus(result?.error === 'Room not found or expired' ? 'expired' : 'error')
          setError(result?.error || 'Cannot join room')
          return
        }
        setStatus('connected')
        setError('')
        setName(result.name)
        setState(result.state)
      })
    }

    socket.on('connect', join)
    socket.on('room:state', setState)
    socket.on('room:expired', () => { setStatus('expired'); setError('Room expired.') })
    socket.on('disconnect', () => {
      clearTimeout(retryTimer)
      setStatus(current => current === 'expired' ? current : 'disconnected')
    })
    socket.on('connect_error', () => {
      setStatus('disconnected')
      setError('Server unavailable. Reconnecting...')
    })

    return () => {
      stopped = true
      clearTimeout(retryTimer)
      socket.removeAllListeners()
      socket.disconnect()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [roomId, key])

  useEffect(() => {
    if (!state || !key) return
    let active = true
    Promise.all(state.messages.map(async message => {
      if (!cacheRef.current.has(message.id)) {
        let text
        try {
          text = await decryptMessage(key, message)
        } catch {
          text = '[cannot decrypt]'
        }
        cacheRef.current.set(message.id, text)
      }
      return { ...message, text: cacheRef.current.get(message.id) }
    })).then(next => {
      if (!active) return
      setMessages(next)
      const ids = new Set(next.map(item => item.id))
      for (const id of cacheRef.current.keys()) {
        if (!ids.has(id)) cacheRef.current.delete(id)
      }
    })
    return () => { active = false }
  }, [state?.messages, key])

  useEffect(() => {
    if (!state) return
    const tick = () => setSeconds(Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state?.expiresAt])

  const timeline = [...(state?.events || []).map(event => ({ ...event, type: 'activity' })), ...messages.map(message => ({ ...message, type: 'message' }))]
    .sort((a, b) => a.createdAt - b.createdAt)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, state?.events])

  useLayoutEffect(() => {
    fitComposer(composerRef.current)
  }, [draft])

  useEffect(() => {
    const resize = () => fitComposer(composerRef.current)
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
    }
  }, [])

  function openRoom(id, code, secret) {
    sessionStorage.setItem('anochat:code:' + id, code)
    window.history.pushState(null, '', '/room/' + id + '#k=' + secret)
    setRoomCode(code)
    setEnterCode('')
    participantIdRef.current = getParticipantId(id)
    setRoomId(id)
  }

  async function createRoom() {
    if (creating || joiningByCode) return
    setCreating(true)
    setError('')
    try {
      const code = generateShortCode()
      const salt = generateRoomSalt()
      const codeHash = await hashShortCode(code)
      const secret = await deriveRoomSecret(code, salt)
      const response = await fetch(api + '/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, maxParticipants, codeHash, salt })
      })
      const room = await response.json()
      if (!response.ok) throw new Error(room.error || 'Room could not be created')
      if (!room.id) throw new Error('Invalid room')
      openRoom(room.id, code, secret)
    } catch (err) {
      setError(err.message || 'Could not create room. Try again.')
    } finally {
      setCreating(false)
    }
  }

  async function joinWithCode() {
    if (creating || joiningByCode) return
    const code = normalizeShortCode(enterCode)
    if (!code) {
      setError('Enter the 8-character room code.')
      return
    }
    setJoiningByCode(true)
    setError('')
    try {
      const codeHash = await hashShortCode(code)
      const response = await fetch(api + '/api/rooms/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeHash })
      })
      const room = await response.json()
      if (!response.ok) throw new Error(room.error || 'Invalid or expired code')
      if (!room.id || !room.salt) throw new Error('Invalid room')
      const secret = await deriveRoomSecret(code, room.salt)
      openRoom(room.id, code, secret)
    } catch (err) {
      setError(err.message || 'Could not join room. Try again.')
    } finally {
      setJoiningByCode(false)
    }
  }

  async function copyRoomCode() {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    } catch {
      setError('Could not copy room code.')
    }
  }

  function resetRoom() {
    window.history.pushState(null, '', '/')
    setRoomId(null)
    setRoomCode(null)
    setKey(null)
    setState(null)
    setMessages([])
    setError('')
    setDraft('')
    setStatus('idle')
    setSending(false)
    pendingRef.current = null
    participantIdRef.current = null
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Copy failed. Copy the URL from the address bar.')
    }
  }

  async function copyMessage(text, id) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMessageId(id)
      setTimeout(() => setCopiedMessageId(current => current === id ? null : current), 1500)
    } catch {
      setError('Copy failed.')
    }
  }

  async function send() {
    const text = draft
    if (!key || !text.trim() || sending || status !== 'connected' || seconds === 0 || text.length > 20000) return
    setSending(true)
    setError('')
    try {
      if (!pendingRef.current || pendingRef.current.text !== text) {
        const encrypted = await encryptMessage(key, text)
        pendingRef.current = { text, ...encrypted, clientMessageId: crypto.randomUUID() }
      }
      const payload = pendingRef.current
      const socket = socketRef.current
      if (!socket?.connected) throw new Error('Disconnected. Reconnect and retry.')
      socket.timeout(10000).emit('message:send', {
        iv: payload.iv, ciphertext: payload.ciphertext, clientMessageId: payload.clientMessageId
      }, (err, result) => {
        setSending(false)
        if (err || !result?.ok) {
          setError(err ? 'Delivery not confirmed. Retry to check.' : result?.error || 'Message failed.')
          return
        }
        if (pendingRef.current?.clientMessageId === payload.clientMessageId) pendingRef.current = null
        setDraft(current => current === text ? '' : current)
        composerRef.current?.focus()
      })
    } catch (err) {
      setSending(false)
      setError(err.message || 'Encryption failed.')
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Tab') {
      event.preventDefault()
      const field = event.currentTarget
      const start = field.selectionStart
      const end = field.selectionEnd
      setDraft(current => current.slice(0, start) + '  ' + current.slice(end))
      requestAnimationFrame(() => { field.selectionStart = field.selectionEnd = start + 2 })
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      send()
    }
  }

  const expired = status === 'expired' || (state !== null && seconds === 0)
  const connected = Boolean(roomId) && status === 'connected' && !expired
  const online = state?.participants || []
  const timer = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')

  return <main className="room">
    <header className="room-header">
      <div className="room-title"><button className="brand" onClick={resetRoom}>anochat</button>{roomId && <span className="room-id">/ {roomId.slice(0, 8)}</span>}</div>
      <div className="room-actions">
        {roomId && <span className="counter">{state ? timer : '--:--'}</span>}
        {roomId && <button onClick={copyInvite}>{copied ? 'copied' : 'copy link'}</button>}
        {roomId && <button onClick={resetRoom}>new</button>}
      </div>
    </header>
    <div className="room-users">
      <span>{roomId ? (connected ? name + ' · connected' : status) : 'not connected'}</span>
      {roomId && roomCode && <span className="room-code"><strong>{roomCode}</strong><button onClick={copyRoomCode}>{copiedCode ? 'copied' : 'copy code'}</button></span>}
      <span>{online.length}/{state?.maxParticipants ?? maxParticipants} online</span>
    </div>
    <section className="message-list" ref={scrollRef} aria-label="Chat messages">
      {!roomId && <div className="room-start">
        <div className="room-options">
          <label>duration
            <select value={duration} onChange={event => setDuration(Number(event.target.value))}>
              {[5, 10, 30].map(value => <option value={value} key={value}>{value} min</option>)}
            </select>
          </label>
          <label>people
            <select value={maxParticipants} onChange={event => setMaxParticipants(Number(event.target.value))}>
              {Array.from({ length: 9 }, (_, index) => index + 2).map(value => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <button className="create-button" onClick={createRoom} disabled={creating || joiningByCode}>{creating ? 'creating...' : 'create room'}</button>
        <form className="code-entry" onSubmit={event => { event.preventDefault(); joinWithCode() }}>
          <input
            aria-label="Enter room code"
            placeholder="enter room code"
            value={enterCode}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={event => { setEnterCode(event.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, '')); setError('') }}
          />
          <button type="submit" disabled={joiningByCode || creating}>{joiningByCode ? '...' : 'join'}</button>
        </form>
      </div>}
      {roomId && timeline.map(item => item.type === 'activity'
        ? <p className="activity" key={item.id}>[{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] {item.name} {item.kind}</p>
        : <div className="message" key={item.id}>
        <div className="message-heading">
          <span className={item.participantId === participantIdRef.current ? 'me' : ''}>{item.name}</span>
          <time>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          <button onClick={() => copyMessage(item.text, item.id)} aria-label="Copy message">{copiedMessageId === item.id ? 'copied' : 'copy'}</button>
        </div>
        <pre>{item.text}</pre>
      </div>)}
      {roomId && connected && !messages.length && <p className="quiet">share the link to invite people.</p>}
      {expired && <p className="quiet">room expired.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    <footer className="composer">
      <div className="composer-row">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={connected ? 'message or paste code...' : 'create or join a room to chat'}
          maxLength={20000}
          rows={1}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={!connected}
          aria-label="Message"
        />
        <button onClick={send} disabled={!connected || sending || !draft.trim()} aria-label="Send message">send</button>
      </div>
      <div className="composer-hint"><span>Enter: send · Shift+Enter: newline · Tab: indent</span>{roomId && <span>encrypted</span>}</div>
    </footer>
  </main>
}

export default App
