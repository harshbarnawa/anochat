import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { decryptMessage, encryptMessage, generateRoomKey, importRoomKey } from './crypto.js'

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

function App() {
  const [roomId, setRoomId] = useState(roomFromPath)
  const [duration, setDuration] = useState(5)
  const [maxParticipants, setMaxParticipants] = useState(4)
  const [creating, setCreating] = useState(false)
  const [key, setKey] = useState(null)
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [messages, setMessages] = useState([])
  const [seconds, setSeconds] = useState(0)
  const [copied, setCopied] = useState(false)
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

    function join() {
      setStatus('connecting')
      socket.timeout(10000).emit('room:join', { roomId, participantId: participantIdRef.current }, (err, result) => {
        if (err) {
          setStatus('disconnected')
          setError('Connection timed out. Retrying...')
          return
        }
        if (!result?.ok) {
          setStatus('error')
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
    socket.on('disconnect', () => setStatus(current => current === 'expired' ? current : 'disconnected'))
    socket.on('connect_error', () => {
      setStatus('disconnected')
      setError('Server unavailable. Reconnecting...')
    })

    return () => {
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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function createRoom() {
    if (creating) return
    setCreating(true)
    setError('')
    try {
      const secret = generateRoomKey()
      const response = await fetch(api + '/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, maxParticipants })
      })
      if (!response.ok) throw new Error('Server unavailable')
      const room = await response.json()
      if (!room.id) throw new Error('Invalid room')
      window.history.pushState(null, '', '/room/' + room.id + '#k=' + secret)
      participantIdRef.current = getParticipantId(room.id)
      setRoomId(room.id)
    } catch {
      setError('Could not create room. Try again.')
    } finally {
      setCreating(false)
    }
  }

  function resetRoom() {
    window.history.pushState(null, '', '/')
    setRoomId(null)
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

  async function copyMessage(text) {
    try {
      await navigator.clipboard.writeText(text)
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
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
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
        <button className="create-button" onClick={createRoom} disabled={creating}>{creating ? 'creating...' : 'create room'}</button>
      </div>}
      {roomId && messages.map(message => <div className="message" key={message.id}>
        <div className="message-heading">
          <span className={message.participantId === participantIdRef.current ? 'me' : ''}>{message.name}</span>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          <button onClick={() => copyMessage(message.text)} aria-label="Copy message">copy</button>
        </div>
        <pre>{message.text}</pre>
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
          rows={2}
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
