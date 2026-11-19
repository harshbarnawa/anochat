import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Clipboard, Clock3, Copy, Hash, Send, Terminal, Users, Wifi, WifiOff } from 'lucide-react'
import { io } from 'socket.io-client'

const durations = [5, 10, 30]
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

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function copyText(text) {
  await navigator.clipboard.writeText(text)
}

function Home() {
  const [duration, setDuration] = useState(10)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  async function createRoom() {
    setWorking(true)
    setError('')
    try {
      const response = await fetch(api + '/api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duration })
      })
      const room = await response.json()
      if (!response.ok) throw new Error(room.error || 'Unable to create room')
      window.location.assign('/room/' + room.id)
    } catch (err) {
      setError(err.message)
      setWorking(false)
    }
  }
  return <div className="home">
    <header className="home-header"><div className="brand"><span className="brand-mark">&gt;_</span> anochat<span className="brand-dot">.</span></div><span className="muted">no accounts. no traces.</span></header>
    <main className="hero">
      <div className="eyebrow"><span className="live-dot" /> ephemeral connection protocol</div>
      <h1>just a room.<br /><span>just a conversation.</span></h1>
      <p>Instant anonymous chat and code sharing between devices. No login, no profile, no permanent history.</p>
      <section className="create-panel">
        <div className="section-title"><Clock3 size={15} /> room lifetime <span className="hint">choose before creating</span></div>
        <div className="duration-picker">{durations.map(value => <button key={value} type="button" className={duration === value ? 'selected' : ''} onClick={() => setDuration(value)}>{value} min</button>)}</div>
        <button className="primary" disabled={working} onClick={createRoom}>{working ? 'creating room...' : 'create secure room'} <ArrowRight size={17} /></button>
        {error && <p role="alert" className="error">{error}</p>}
      </section>
      <div className="home-footnotes"><span><Hash size={13} /> unique room link</span><span><Users size={13} /> max 2 people</span><span><Clock3 size={13} /> 5 min message history</span></div>
    </main>
    <footer className="footer">anochat / open-source learning project <span>messages live temporarily in server memory · not end-to-end encrypted</span></footer>
  </div>
}

function Room({ roomId }) {
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)
  const composerRef = useRef(null)
  const socketRef = useRef(null)
  const participantIdRef = useRef(getParticipantId(roomId))

  useEffect(() => {
    const socket = io(socketUrl, { autoConnect: true, reconnection: true, transports: ['websocket', 'polling'] })
    socketRef.current = socket
    const join = () => {
      setStatus('connecting')
      socket.timeout(8000).emit('room:join', { roomId, participantId: participantIdRef.current }, (err, result) => {
        if (err) {
          setStatus('error')
          setError('Connection timed out. Trying again...')
          return
        }
        if (!result.ok) {
          setStatus('error')
          setError(result.error)
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
    socket.on('room:expired', () => {
      setStatus('expired')
      setError('This room has expired. Create a new room to continue.')
    })
    socket.on('disconnect', () => setStatus(current => current === 'expired' ? current : 'disconnected'))
    socket.on('connect_error', () => {
      setStatus('disconnected')
      setError('Cannot reach the chat server.')
    })
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
    }
  }, [roomId])

  useEffect(() => {
    if (!state) return
    const update = () => setSeconds(Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [state?.expiresAt])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [state?.messages])

  async function share() {
    try {
      await copyText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Clipboard unavailable. Copy the address bar URL.')
    }
  }

  function send() {
    if (!draft.trim() || sending || status !== 'connected' || draft.length > 20000) return
    setSending(true)
    setError('')
    socketRef.current.timeout(8000).emit('message:send', { text: draft }, (err, result) => {
      setSending(false)
      if (err || !result?.ok) {
        setError(err ? 'Delivery acknowledgement timed out. Check the room before retrying.' : result.error)
        return
      }
      setDraft('')
      composerRef.current?.focus()
    })
  }

  function onKeyDown(event) {
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = event.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      setDraft(value => value.slice(0, start) + '  ' + value.slice(end))
      requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2 })
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      send()
    }
  }

  const expired = status === 'expired' || (state && seconds === 0)
  const connected = status === 'connected' && !expired
  const messages = state?.messages || []
  const members = state?.participants || []
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const secs = String(seconds % 60).padStart(2, '0')

  return <div className="room-layout">
    <div className="chat">
      <header className="chat-header">
        <div className="chat-title"><a href="/" className="brand small"><span className="brand-mark">&gt;_</span> anochat<span className="brand-dot">.</span></a><span className="separator">/</span><span className="room-tag">room/{roomId.slice(0, 8)}</span></div>
        <div className="header-actions"><div className="time"><Clock3 size={13} /> {state ? minutes + ':' + secs : '--:--'}</div><button className="outline" onClick={share}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'copied' : 'copy invite'}</button></div>
      </header>
      <div className="status-line"><span className={connected ? 'live-dot' : 'offline-dot'} /> {connected ? 'connected as ' + name : status} <span className="mobile-count">· {members.length}/2 online</span><span className="retention-note">messages disappear after 5 min</span></div>
      <div className="messages" ref={scrollRef}>
        <p className="system-line">[system] welcome to anochat. share your link to invite one person.</p>
        {messages.map(message => <div className="message" key={message.id}>
          <div className="message-meta"><span className={message.participantId === participantIdRef.current ? 'self-name' : 'other-name'}>{message.name}@anochat</span><span className="timestamp">{timeLabel(message.createdAt)}</span><button className="copy-message" title="Copy message" onClick={() => copyText(message.text)}><Copy size={13} /></button></div>
          <pre className="message-text">{message.text}</pre>
        </div>)}
        {expired && <p className="system-line">[system] room expired. <a href="/">create a new room</a></p>}
        {error && <p role="alert" className="error">[error] {error}</p>}
      </div>
      <div className="composer">
        <div className="composer-label"><Terminal size={13} /> compose <span>Enter = new line · Ctrl+Enter = send · Tab = indent</span></div>
        <div className="composer-row"><textarea ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="message or paste code here..." rows={3} maxLength={20000} disabled={!connected} aria-label="Message or code" /><button className="send" onClick={send} disabled={!connected || !draft.trim() || sending} title="Send (Ctrl+Enter)"><Send size={18} /></button></div>
        <div className="composer-footer"><span>whitespace + indentation preserved</span><span>{draft.length}/20000</span></div>
      </div>
    </div>
    <aside className="sidebar">
      <div className="sidebar-heading"><Users size={15} /> ONLINE USERS <span>{members.length}/2</span></div>
      {members.map(member => <div className="member" key={member.id}><span className="live-dot" /> {member.name} {member.id === participantIdRef.current && <span className="you">(you)</span>}</div>)}
      {!members.length && <div className="muted small-note">Waiting for connection...</div>}
      <div className="sidebar-bottom"><div className="muted">SESSION</div><div className="session-row"><span>lifetime</span><span>{state?.duration || '–'} min</span></div><div className="session-row"><span>history</span><span>5 min</span></div><div className="session-row"><span>participants</span><span>max 2</span></div><div className="security-note">Temporary memory only. Do not send passwords or secrets. No end-to-end encryption.</div></div>
    </aside>
  </div>
}

export default function App() {
  const match = window.location.pathname.match(/^\/room\/([0-9a-f-]{36})\/?$/i)
  return match ? <Room roomId={match[1]} /> : <Home />
}
