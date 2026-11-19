import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { decryptMessage, encryptMessage, generateRoomKey, importRoomKey } from './crypto.js'

const api = import.meta.env.VITE_API_URL || ''
const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin

function participantIdFor(roomId) {
  const key = 'anochat:' + roomId
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(key, id)
  }
  return id
}

function Home() {
  const [duration, setDuration] = useState(5)
  const [maxParticipants, setMaxParticipants] = useState(4)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function createRoom() {
    setWorking(true)
    setError('')
    try {
      const roomKey = generateRoomKey()
      const response = await fetch(api + '/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration, maxParticipants })
      })
      const room = await response.json()
      if (!response.ok) throw new Error(room.error || 'Could not create room')
      window.location.assign('/room/' + room.id + '#k=' + roomKey)
    } catch {
      setError('Server unavailable. Try again later.')
      setWorking(false)
    }
  }

  return <main className="home">
    <div className="home-content">
      <h1>anochat</h1>
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
      <button className="create-button" disabled={working} onClick={createRoom}>
        {working ? 'creating...' : 'create room'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </main>
}

function Room({ roomId }) {
  const [roomKey, setRoomKey] = useState(null)
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [decodedMessages, setDecodedMessages] = useState([])
  const [seconds, setSeconds] = useState(0)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const socketRef = useRef(null)
  const composerRef = useRef(null)
  const scrollRef = useRef(null)
  const pendingRef = useRef(null)
  const cacheRef = useRef(new Map())
  const participantIdRef = useRef(participantIdFor(roomId))

  useEffect(() => {
    let active = true
    importRoomKey(window.location.hash)
      .then(key => { if (active) setRoomKey(key) })
      .catch(err => { if (active) { setStatus('invalid'); setError(err.message) } })
    return () => { active = false }
  }, [roomId])

  useEffect(() => {
    if (!roomKey) return
    const socket = io(socketUrl, { reconnection: true, transports: ['websocket', 'polling'] })
    socketRef.current = socket

    function join() {
      setStatus('connecting')
      socket.timeout(8000).emit('room:join', { roomId, participantId: participantIdRef.current }, (err, result) => {
        if (err) {
          setStatus('disconnected')
          setError('Connection timed out. Reconnecting...')
          return
        }
        if (!result?.ok) {
          setStatus('error')
          setError(result?.error || 'Cannot join room')
          return
        }
        setName(result.name)
        setState(result.state)
        setStatus('connected')
        setError('')
      })
    }

    socket.on('connect', join)
    socket.on('room:state', setState)
    socket.on('room:expired', () => { setStatus('expired'); setError('Room expired.') })
    socket.on('disconnect', () => setStatus(value => value === 'expired' ? value : 'disconnected'))
    socket.on('connect_error', () => { setStatus('disconnected'); setError('Cannot reach chat server.') })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId, roomKey])

  useEffect(() => {
    if (!state || !roomKey) return
    let active = true
    Promise.all(state.messages.map(async message => {
      if (!cacheRef.current.has(message.id)) {
        let text
        try {
          text = await decryptMessage(roomKey, message)
        } catch {
          text = '[unable to decrypt message]'
        }
        cacheRef.current.set(message.id, text)
      }
      return { ...message, text: cacheRef.current.get(message.id) }
    })).then(messages => {
      if (!active) return
      setDecodedMessages(messages)
      const ids = new Set(messages.map(message => message.id))
      for (const id of cacheRef.current.keys()) if (!ids.has(id)) cacheRef.current.delete(id)
    })
    return () => { active = false }
  }, [roomKey, state?.messages])

  useEffect(() => {
    if (!state) return
    function tick() {
      setSeconds(Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [state?.expiresAt])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [decodedMessages])

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy link. Copy it from address bar.')
    }
  }

  async function copyMessage(text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      setError('Could not copy message.')
    }
  }

  async function send() {
    const text = draft
    if (!roomKey || !text.trim() || sending || status !== 'connected' || seconds === 0 || text.length > 20000) return
    setSending(true)
    setError('')
    try {
      if (!pendingRef.current || pendingRef.current.text !== text) {
        const encrypted = await encryptMessage(roomKey, text)
        pendingRef.current = { text, ...encrypted, clientMessageId: crypto.randomUUID() }
      }
      const payload = pendingRef.current
      const socket = socketRef.current
      if (!socket?.connected) throw new Error('Disconnected.')
      socket.timeout(8000).emit('message:send', {
        iv: payload.iv, ciphertext: payload.ciphertext, clientMessageId: payload.clientMessageId
      }, (err, result) => {
        setSending(false)
        if (err || !result?.ok) {
          setError(err ? 'Delivery not confirmed. You can retry.' : result?.error || 'Message not sent.')
          return
        }
        if (pendingRef.current?.clientMessageId === payload.clientMessageId) pendingRef.current = null
        setDraft(value => value === text ? '' : value)
        composerRef.current?.focus()
      })
    } catch (err) {
      setSending(false)
      setError(err.message || 'Failed to encrypt message.')
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === 'Tab') {
      event.preventDefault()
      const field = event.currentTarget
      const start = field.selectionStart
      const end = field.selectionEnd
      setDraft(value => value.slice(0, start) + '  ' + value.slice(end))
      requestAnimationFrame(() => { field.selectionStart = field.selectionEnd = start + 2 })
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      send()
    }
  }

  const expired = status === 'expired' || (state !== null && seconds === 0)
  const online = state?.participants || []
  const connected = status === 'connected' && !expired
  const count = online.length + '/' + (state?.maxParticipants || '–')
  const timer = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')

  return <main className="room">
    <header className="room-header">
      <div className="room-title"><a href="/">anochat</a><span>room/{roomId.slice(0, 8)}</span></div>
      <div className="room-actions"><span className="counter">{state ? timer : '--:--'}</span><button onClick={copyInvite}>{copied ? 'copied' : 'copy link'}</button></div>
    </header>
    <div className="room-users"><span>{connected ? 'connected as ' + name : status}</span><span>{count} online</span></div>
    <div className="message-list" ref={scrollRef}>
      {decodedMessages.map(message => <div className="message" key={message.id}>
        <div className="message-heading"><span className={message.participantId === participantIdRef.current ? 'me' : ''}>{message.name}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><button onClick={() => copyMessage(message.text)} aria-label="Copy message">copy</button></div>
        <pre>{message.text}</pre>
      </div>)}
      {!decodedMessages.length && connected && <p className="quiet">share the invite link to start chatting.</p>}
      {expired && <p className="quiet">room expired. <a href="/">create another</a></p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <footer className="composer">
      <div className="composer-row">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={connected ? 'message or paste code...' : 'not connected'}
          maxLength={20000}
          rows={3}
          disabled={!connected}
          aria-label="Message"
        />
        <button onClick={send} disabled={!connected || sending || !draft.trim()} aria-label="Send message">send</button>
      </div>
      <div className="composer-hint"><span>Enter: newline · Ctrl+Enter: send · Tab: indent</span><span>encrypted</span></div>
    </footer>
  </main>
}

export default function App() {
  const match = window.location.pathname.match(/^\/room\/([0-9a-f-]{36})\/?$/i)
  return match ? <Room roomId={match[1]} /> : <Home />
}
