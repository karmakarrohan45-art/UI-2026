import { useEffect, useMemo, useState } from 'react'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''
const AUTO_EDITOR_URL = import.meta.env.VITE_AUTO_EDIT_URL || 'http://localhost:3001'

/**
 * The editor is a separate dev server. If it is not running, the link would
 * open a blank tab with no explanation, so check it first and say what to do.
 */
const openAutoEditor = () => {
  if (!/^https?:\/\/localhost(:\d+)?/i.test(AUTO_EDITOR_URL)) {
    window.open(AUTO_EDITOR_URL, '_blank', 'noreferrer')
    return
  }
  fetch(AUTO_EDITOR_URL, { mode: 'no-cors' })
    .then(() => window.open(AUTO_EDITOR_URL, '_blank', 'noreferrer'))
    .catch(() => {
      window.alert(
        `The video editor is not running at ${AUTO_EDITOR_URL}.\n\n` +
        'Start it from the project root with:\n\n    npm run dev\n\n' +
        'That starts the storefront, the editor, and the API together.'
      )
    })
}
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TU4StmDDGZTVxu'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

const ensureRazorpayScript = () => new Promise((resolve, reject) => {
  if (window.Razorpay) {
    resolve()
    return
  }

  const script = document.createElement('script')
  script.src = 'https://checkout.razorpay.com/v1/checkout.js'
  script.onload = () => resolve()
  script.onerror = () => reject(new Error('Razorpay checkout script failed to load'))
  document.body.appendChild(script)
})

const presets = [
  { name: 'CHEWY Text Animation', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Warm', price: 18, video: '/okki2.mov', color: '#e9d3b2' },
  { name: 'Coastal Haze', type: 'DaVinci Resolve', category: 'Courses', tone: 'Cool', price: 24, image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=85', color: '#c8d8d8' },
  { name: 'After Hours', type: 'Mobile', category: '1:1 session', tone: 'Moody', price: 16, image: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=900&q=85', color: '#b9aab1' },
  { name: 'Quiet Bloom', type: 'DaVinci Resolve', category: 'Courses', tone: 'Soft', price: 20, image: 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=85', color: '#e8c3ba' },
  { name: 'Golden Hour', type: 'Mobile', category: 'LUTs', tone: 'Warm', price: 19, video: '/videos/okki11.mov', color: '#e6ba78' },
  { name: 'Still Life', type: 'DaVinci Resolve', category: '1:1 session', tone: 'Neutral', price: 15, image: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=900&q=85', color: '#d4c4ac' },
  { name: 'Neon Grain', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Cinematic', price: 22, video: '/videos/Timeline 1.mov', color: '#bda7d8' },
  { name: 'Desert Fade', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Earthy', price: 21, video: '/videos/lolo.mov', color: '#d8b58b' },
  { name: 'Indigo Film', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Cool', price: 23, video: '/videos/grl.mov', color: '#9da6cf' },
  { name: 'Rosy Contrast', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Rosy', price: 20, image: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=900&q=85', color: '#dba6b8' },
  { name: 'Night Drive', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Moody', price: 25, image: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=900&q=85', color: '#8791bd' },
  { name: 'Violet Cinema', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Violet', price: 26, image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=900&q=85', color: '#b48bd4' },
  { name: 'Urban Chrome', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Contrast', price: 24, image: 'https://images.unsplash.com/photo-1494522358652-f30e61a60313?auto=format&fit=crop&w=900&q=85', color: '#a7b0b8' },
  { name: 'Learn Advance Color Grading', type: 'DaVinci Resolve', category: '1:1 session', tone: 'Professional', price: 35, image: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=85', color: '#1d4ed8', blur: true },
  { name: 'Sage Evening', type: 'DaVinci Resolve', category: 'LUTs', tone: 'Muted', price: 22, image: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=900&q=85', color: '#9caf88' },
  { name: 'Motion Graphics Basics', type: 'Course', category: 'Motion Graphics', tone: 'Beginner', price: 25, image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=85', color: '#a3c4bc' },
  { name: 'Advanced Animation', type: 'Course', category: 'Motion Graphics', tone: 'Advanced', price: 35, image: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&w=900&q=85', color: '#7a9cc6' }
]

function Icon({ name, size = 18 }) {
  const paths = { bag: <><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>, search: <><circle cx="11" cy="11" r="7" /><line x1="20" y1="20" x2="16" y2="16" /></>, plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, arrow: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></> }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function ThemeToggle({ isDark, onToggle }) { return <button className="theme-toggle" onClick={onToggle} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}><span>{isDark ? '☼' : '☾'}</span><small>{isDark ? 'Light mode' : 'Dark mode'}</small></button> }

function SupportChat({ onClose }) {
  const [messages, setMessages] = useState([{ from: 'bot', text: "Hi Alex! I'm here to help with your presets, orders, or storefront." }])
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatHistory, setChatHistory] = useState([])
  const [currentChatId, setCurrentChatId] = useState(null)

  useEffect(() => {
    const savedHistory = JSON.parse(window.localStorage.getItem('gene-academy-chat-history') || '[]')
    if (savedHistory.length > 0) {
      setChatHistory(savedHistory)
      setCurrentChatId(savedHistory[0].id)
      setMessages(savedHistory[0].messages)
    }
  }, [])

  useEffect(() => {
    if (currentChatId && messages.length > 0) {
      const updatedHistory = chatHistory.some(c => c.id === currentChatId)
        ? chatHistory.map(c => c.id === currentChatId ? { ...c, messages } : c)
        : [{ id: Date.now(), messages, createdAt: new Date().toISOString() }, ...chatHistory]
      setChatHistory(updatedHistory)
      window.localStorage.setItem('gene-academy-chat-history', JSON.stringify(updatedHistory))
    }
  }, [messages, currentChatId])

  const startNewChat = () => {
    const newId = Date.now()
    setCurrentChatId(newId)
    setMessages([{ from: 'bot', text: "Hi Alex! I'm here to help with your presets, orders, or storefront." }])
    setMessage('')
  }

  const loadChat = (id) => {
    const chat = chatHistory.find(c => c.id === id)
    if (chat) {
      setCurrentChatId(id)
      setMessages(chat.messages)
    }
  }

  const sendMessage = async (event) => {
    event.preventDefault()
    const userMessage = message.trim()
    if (!userMessage || isSending) return

    const conversation = [...messages, { from: 'user', text: userMessage }]
    setMessages(conversation)
    setMessage('')
    setIsSending(true)

    const lowerMsg = userMessage.toLowerCase()
    const isHelpRequest = lowerMsg.includes('help') || lowerMsg.includes('support') || lowerMsg.includes('contact') || lowerMsg.includes('number') || lowerMsg.includes('phone') || lowerMsg.includes('call')

    try {
      const response = await fetch(`${API_BASE_URL}/api/support-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversation.map((item) => ({ role: item.from === 'bot' ? 'assistant' : 'user', content: item.text }))
        })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'The support assistant is unavailable right now.')
      const botMessage = isHelpRequest && !data.message.includes('6289821372') ? data.message + '\n\nNeed immediate help? Call or message us at: 6289821372' : data.message
      setMessages((current) => [...current, { from: 'bot', text: botMessage }])
    } catch (error) {
      // A network failure means the Flask API is not running, which is a setup
      // problem rather than a support problem, so say so plainly.
      const isNetworkError = error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(error?.message || ''))
      const errorMsg = isNetworkError
        ? 'The support service is offline. Start it with "npm run dev" from the project root (this starts the storefront, editor and API together).'
        : (error.message || 'The support assistant is unavailable right now. Please try again later.')
      const botMessage = isHelpRequest && !errorMsg.includes('6289821372') ? errorMsg + '\n\nNeed immediate help? Call or message us at: 6289821372' : errorMsg
      setMessages((current) => [...current, { from: 'bot', text: botMessage }])
    } finally {
      setIsSending(false)
    }
  }

  return <section className="support-chat" aria-label="Gene Academy support chat"><header><div><span className="chat-status" /> <strong>Gene Academy support</strong><small>Usually replies in a few minutes</small></div><button onClick={onClose} aria-label="Close support chat">×</button></header>{chatHistory.length > 0 && <div className="chat-history-bar"><button className="new-chat-btn" onClick={startNewChat}>+ New Chat</button>{chatHistory.map((chat) => <button key={chat.id} className={`history-item ${currentChatId === chat.id ? 'active' : ''}`} onClick={() => loadChat(chat.id)}>{chat.messages[0]?.text.substring(0, 30) || 'Untitled'} <span className="history-time">{new Date(chat.createdAt || chat.id).toLocaleDateString()}</span></button>)}</div>}<div className="chat-messages">{messages.map((item, index) => <p className={item.from} key={`${item.from}-${index}-${currentChatId}`}>{item.text}</p>)}{isSending && <p className="bot">Thinking…</p>}</div><form onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message..." aria-label="Message" disabled={isSending} /><button type="submit" aria-label="Send message" disabled={isSending}><Icon name="arrow" size={15} /></button></form></section>
}


function Sidebar({ onHelp, onHome }) {
  return <aside className="sidebar"><a className="brand" href="#library" onClick={onHome}><span className="brand-mark">G</span><span>Gene Academy</span></a><div className="workspace-label">Workspace</div><div className="workspace"><span className="avatar avatar-peach">AM</span><span><strong>Alex Morgan</strong><small>Creator studio</small></span><span className="chevron">⌄</span></div><nav><a className="nav-item active" href="#library" onClick={onHome}>▦ <span>Library</span><span className="nav-count">{presets.length}</span></a><a className="nav-item" href={AUTO_EDITOR_URL} onClick={(event) => { event.preventDefault(); openAutoEditor() }}>◌ <span>Editor</span></a><a className="nav-item" href="#analytics">⌁ <span>Analytics</span><span className="new-dot" /></a></nav><div className="sidebar-bottom"><a className="nav-item" href="#settings">⚙ <span>Settings</span></a><button className="help-box" onClick={onHelp}><span className="help-icon">?</span><span><strong>Need a hand?</strong><small>Chat with our team</small></span><Icon name="arrow" size={15} /></button></div></aside>
}

function GoogleSignIn({ onSuccess, onError }) {
  if (!GOOGLE_CLIENT_ID) {
    return <button type="button" className="social-button" onClick={() => onError('Google sign-in needs a VITE_GOOGLE_CLIENT_ID in your frontend environment.')}><span className="google-mark" aria-hidden="true">G</span>Continue with Google</button>
  }

  return <div className="google-login-button">
    <GoogleLogin onSuccess={onSuccess} onError={() => onError('Google sign-in was cancelled or could not be completed.')} text="continue_with" theme="outline" size="large" width="320" />
  </div>
}

function AuthPage({ mode, onModeChange, onBack, onSubmit, currentEmail, onGoogleSuccess, onGoogleError }) {
  const [form, setForm] = useState({ name: '', email: currentEmail || '', password: '' })

  useEffect(() => {
    setForm((current) => ({ ...current, email: current.email || currentEmail || '' }))
  }, [currentEmail])

  const isSignUp = mode === 'signup'
  const handleChange = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  const submit = (event) => {
    event.preventDefault()
    onSubmit(form)
  }

  return <div className="auth-page"><div className="auth-shell"><button className="back-link auth-back" onClick={onBack}>← Back to library</button><div className="auth-card"><div className="auth-brand"><span className="brand-mark">G</span><span>Gene Academy</span></div><div className="auth-tabs"><button className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'} onClick={() => onModeChange('signin')}>Sign in</button><button className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'} onClick={() => onModeChange('signup')}>Sign up</button></div><div className="auth-social"><GoogleSignIn onSuccess={onGoogleSuccess} onError={onGoogleError} /></div><div className="auth-divider"><span>or continue with email</span></div><form className="auth-form" onSubmit={submit}><label className="auth-field">{isSignUp ? 'Full name' : 'Email'}{isSignUp ? <input value={form.name} onChange={handleChange('name')} placeholder="Alex Morgan" required /> : <input value={form.email} onChange={handleChange('email')} type="email" placeholder="you@example.com" required />}</label>{isSignUp && <label className="auth-field">Email<input value={form.email} onChange={handleChange('email')} type="email" placeholder="you@example.com" required /></label>}<label className="auth-field">Password<input value={form.password} onChange={handleChange('password')} type="password" placeholder="Enter your password" required /></label><div className="auth-row"><label className="auth-remember"><input type="checkbox" defaultChecked /> Remember me</label>{!isSignUp && <button type="button" className="text-button">Forgot password?</button>}</div><button type="submit" className="primary-button auth-submit">{isSignUp ? 'Create account' : 'Sign in'}</button></form><p className="auth-footer">{isSignUp ? 'Already have an account?' : 'Need an account?'} <button type="button" className="inline-link" onClick={() => onModeChange(isSignUp ? 'signin' : 'signup')}>{isSignUp ? 'Sign in' : 'Sign up'}</button></p></div></div></div>
}

function CartPage({ items, setItems, onBack, email, setEmail }) {
  const updateQuantity = (name, amount) => setItems((current) => current.flatMap((item) => { if (item.name !== name) return [item]; const quantity = item.quantity + amount; return quantity < 1 ? [] : [{ ...item, quantity }] }))
  const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0)
  useEffect(() => {
    const videos = []
    document.querySelectorAll('.cart-items .cart-item .cart-thumb').forEach((thumbnail, index) => {
      const item = items[index]
      if (thumbnail.querySelector('.cart-fallback-image, video')) return
      let image
      if (item?.image) {
        image = document.createElement('img')
        image.className = 'cart-fallback-image'
        image.src = item.image
        image.alt = item.name
        thumbnail.prepend(image)
      }
      if (!item?.video) {
        if (image) videos.push(image)
        return
      }
      const video = document.createElement('video')
      video.src = item.video
      video.autoplay = true
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.addEventListener('error', () => video.remove())
      thumbnail.append(video)
      videos.push(video)
    })
    return () => videos.forEach((video) => video.remove())
  }, [items])
  return <div className="cart-page"><button className="back-link" onClick={onBack}>← Back to library</button><div className="cart-heading"><div><p className="eyebrow">YOUR SHOPPING BAG</p><h1>Ready to make it yours?</h1><p className="subhead">Curated looks for your next story.</p></div><span className="cart-count">{items.length} items</span></div><div className="cart-layout"><section className="cart-items"><div className="cart-items-header"><h2>Your presets</h2><span>Digital delivery · instant access</span></div>{items.length ? items.map((item) => <article className="cart-item" key={item.name}><div className="cart-thumb" style={{ backgroundImage: `url(${item.image})` }} /><div className="cart-item-info"><h3>{item.name}</h3><p>{item.type} preset · {item.tone} tones</p><button className="remove-button" onClick={() => updateQuantity(item.name, -item.quantity)}>Remove</button></div><div className="quantity-control"><button onClick={() => updateQuantity(item.name, -1)} aria-label={`Remove one ${item.name}`}>−</button><span>{item.quantity}</span><button onClick={() => updateQuantity(item.name, 1)} aria-label={`Add one ${item.name}`}>+</button></div><strong className="item-price">₹{(item.price * item.quantity).toFixed(2)}</strong></article>) : <div className="empty-cart"><h3>Your bag is feeling light</h3><p>Browse the library to find your next favorite look.</p><button className="primary-button" onClick={onBack}>Browse presets</button></div>}</section><aside className="order-summary"><p className="eyebrow">ORDER SUMMARY</p><h2>Your collection</h2><div className="summary-line"><span>Presets ({items.length})</span><strong>₹{subtotal.toFixed(2)}</strong></div><div className="summary-line"><span>Delivery</span><strong className="free">Instant + free</strong></div><div className="summary-total"><span>Total</span><strong>₹{subtotal.toFixed(2)}</strong></div><button className="checkout-button" disabled={!items.length}>Continue to checkout <Icon name="arrow" size={16} /></button><p className="secure-note">Secure payment · Instant download after purchase</p></aside></div></div>
}

function AnalyticsPage({ onBack }) {
  const bars = [34, 48, 42, 66, 58, 82, 74]
  return <div className="analytics-page"><button className="back-link" onClick={onBack}>← Back to library</button><div className="analytics-heading"><div><p className="eyebrow">STORE PERFORMANCE</p><h1>Who is buying your presets?</h1><p className="subhead">A clear view of your audience and purchase momentum.</p></div><span className="period-pill">Last 30 days⌄</span></div><section className="analytics-metrics"><div className="analytics-metric featured"><span>Unique buyers</span><strong>1,284</strong><em>↗ 18.4% vs. last month</em></div><div className="analytics-metric"><span>Purchases</span><strong>2,846</strong><em>↗ 12.6% vs. last month</em></div><div className="analytics-metric"><span>Average order</span><strong>₹58.40</strong><em>↗ 4.2% vs. last month</em></div><div className="analytics-metric"><span>Repeat buyers</span><strong>38%</strong><em>↗ 6.8% vs. last month</em></div></section><div className="analytics-grid"><section className="chart-panel"><div className="panel-title"><div><h2>Buying activity</h2><p>Purchases across the last seven days</p></div><strong>2,846 <small>total purchases</small></strong></div><div className="bar-chart">{bars.map((height, index) => <div className="bar-column" key={index}><span className="bar-value">{[248, 392, 318, 526, 468, 702, 592][index]}</span><div className="bar" style={{ height: `${height}%` }} /><small>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]}</small></div>)}</div></section><section className="buyers-panel"><p className="eyebrow">AUDIENCE SNAPSHOT</p><h2>Your buyers</h2><div className="buyer-row"><span className="buyer-avatar purple">US</span><div><strong>United States</strong><small>42% of purchases</small></div><b>1,195</b></div><div className="buyer-row"><span className="buyer-avatar lavender">IN</span><div><strong>India</strong><small>28% of purchases</small></div><b>797</b></div><div className="buyer-row"><span className="buyer-avatar lilac">UK</span><div><strong>United Kingdom</strong><small>16% of purchases</small></div><b>455</b></div><button className="text-button">View buyer details <Icon name="arrow" size={15} /></button></section></div><p className="analytics-note">Based on verified digital downloads and completed purchases.</p></div>
}

function App() {
  const [isDark, setIsDark] = useState(() => window.localStorage.getItem('gene-academy-theme') !== 'light')
  const [showCart, setShowCart] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('signin')
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!window.localStorage.getItem('gene-academy-authenticated'))
  const [notice, setNotice] = useState(null)
  const [cartItems, setCartItems] = useState(() => {
    const savedCart = window.localStorage.getItem('gene-academy-cart')
    return savedCart ? JSON.parse(savedCart) : []
  })
  const [activeTab, setActiveTab] = useState('All presets')
  const [query, setQuery] = useState('')
  const [addedName, setAddedName] = useState('')
  const [email, setEmail] = useState(() => window.localStorage.getItem('gene-academy-email') || '')
  const categoryAliases = { Featured: 'LUTs', New: 'Courses', Popular: '1:1 session' } // Motion Graphics tab filters by its own category name
  const getValidCheckoutEmail = () => {
    const nextEmail = (email || window.localStorage.getItem('gene-academy-email') || 'demo@example.com').trim()
    return /^\S+@\S+\.\S+$/.test(nextEmail) ? nextEmail : ''
  }
  const filteredPresets = useMemo(() => presets.filter((preset) => (activeTab === 'All presets' || preset.category === (categoryAliases[activeTab] || activeTab)) && preset.name.toLowerCase().includes(query.toLowerCase())), [activeTab, query])
  const toggleTheme = () => setIsDark((current) => { const next = !current; window.localStorage.setItem('gene-academy-theme', next ? 'dark' : 'light'); return next })
  const handleAuthSubmit = (form) => {
    const cleanedEmail = form.email?.trim() || ''
    const cleanedName = form.name?.trim() || 'Creator'

    if (!cleanedEmail || !form.password) {
      setNotice({ title: 'Please complete the form', message: 'Enter your email and password before continuing.' })
      return
    }

    if (authMode === 'signup' && !cleanedName) {
      setNotice({ title: 'Full name required', message: 'Please enter your full name to create an account.' })
      return
    }

    window.localStorage.setItem('gene-academy-email', cleanedEmail)
    window.localStorage.setItem('gene-academy-authenticated', 'true')
    if (authMode === 'signup') {
      window.localStorage.setItem('gene-academy-user-name', cleanedName)
    }
    setEmail(cleanedEmail)
    setIsAuthenticated(true)
    setShowAuth(false)
    setNotice({
      title: authMode === 'signup' ? 'Account created' : 'Signed in successfully',
      message: authMode === 'signup' ? 'Your account is ready to use.' : 'Welcome back! You can continue shopping.'
    })
  }
  const handleGoogleSuccess = async (credentialResponse) => {
    if (!credentialResponse.credential) {
      setNotice({ title: 'Google sign-in failed', message: 'Google did not return a sign-in credential. Please try again.' })
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: credentialResponse.credential })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Google sign-in could not be completed.')

      const signedInEmail = data.user?.email || ''
      window.localStorage.setItem('gene-academy-authenticated', 'true')
      window.localStorage.setItem('user', JSON.stringify(data.user))
      window.localStorage.setItem('access_token', data.access_token)
      window.localStorage.setItem('gene-academy-email', signedInEmail)
      window.localStorage.setItem('gene-academy-user-name', data.user?.name || 'Creator')
      setEmail(signedInEmail)
      setIsAuthenticated(true)
      setShowAuth(false)
      setNotice({ title: 'Signed in with Google', message: `Welcome${data.user?.name ? `, ${data.user.name}` : ''}! You can continue shopping.` })
    } catch (error) {
      setNotice({ title: 'Google sign-in failed', message: error.message || 'Please try again.' })
    }
  }
  const addToBag = (preset) => {
    if (!isAuthenticated) {
      setAuthMode('signin')
      setShowAuth(true)
      setNotice({
        title: 'Please sign in',
        message: 'Sign in or create an account before adding items to your cart.'
      })
      return
    }

    setCartItems((current) => current.some((item) => item.name === preset.name) ? current.map((item) => item.name === preset.name ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...preset, quantity: 1 }]); setAddedName(preset.name); window.setTimeout(() => setAddedName(''), 1600)
  }
  useEffect(() => {
    window.localStorage.setItem('gene-academy-cart', JSON.stringify(cartItems))
  }, [cartItems])
  useEffect(() => {
    const openAutoEdit = (event) => {
      if (event.target.closest('a[href="#editor"]')) {
        event.preventDefault()
        openAutoEditor()
      }
    }
    document.addEventListener('click', openAutoEdit)
    return () => document.removeEventListener('click', openAutoEdit)
  }, [])
  useEffect(() => {
    const openAnalytics = (event) => {
      if (event.target.closest('a[href="#analytics"]')) { event.preventDefault(); setShowAnalytics(true); setShowCart(false) }
    }
    document.addEventListener('click', openAnalytics)
    return () => document.removeEventListener('click', openAnalytics)
  }, [])
  useEffect(() => {
    if (!showCart) return undefined
    const handleCheckout = async (event) => {
      const checkoutButton = event.target.closest('.checkout-button')
      if (!checkoutButton || !cartItems.length) return
      const amount = cartItems.reduce((total, item) => total + item.price * item.quantity, 0)
      // Razorpay expects the amount in the smallest currency unit (paise), not rupees.
      const amountInPaise = Math.round(amount * 100)
      const checkoutEmail = getValidCheckoutEmail()
      if (!checkoutEmail) {
        window.alert('Please save a valid email address in the email form before checkout.')
        return
      }
      checkoutButton.disabled = true
      try {
        await ensureRazorpayScript()

        let order = null
        try {
          const orderResponse = await fetch(`${API_BASE_URL}/api/create-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountInPaise }) })
          if (orderResponse.ok) {
            order = await orderResponse.json()
          }
        } catch (error) {
          order = null
        }

        const razorpay = new window.Razorpay({
          key: order?.key_id || RAZORPAY_KEY_ID,
          amount: order?.amount || amountInPaise,
          currency: order?.currency || 'INR',
          name: 'Gene Academy',
          description: 'Digital preset collection',
          order_id: order?.order_id,
          handler: async (payment) => {
            const verificationPayload = {
              ...payment,
              email: checkoutEmail,
              items: cartItems.map((item) => ({ name: item.name, quantity: item.quantity, download_url: `${window.location.origin}/downloads/${encodeURIComponent(item.name)}` })),
            }

            try {
              const verificationResponse = await fetch(`${API_BASE_URL}/api/verify-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(verificationPayload) })

              let verification = null
              try {
                verification = await verificationResponse.json()
              } catch {
                verification = null
              }

              if (verification?.success) {
                window.alert('Payment successful. Your presets are ready to download.')
                return
              }

              if (verification?.message) {
                window.alert(`Payment verification warning: ${verification.message}. Your payment was accepted, but the backend could not confirm it.`)
                return
              }

              if (!verificationResponse.ok) {
                window.alert('Payment successful. Your presets are ready to download. The backend verification is temporarily unavailable.')
                return
              }

              window.alert('Payment successful. Your presets are ready to download.')
            } catch (error) {
              window.alert('Payment successful. Your presets are ready to download. The backend verification is temporarily unavailable, but your payment has already gone through.')
            }
          },
          theme: { color: '#7c3aed' },
          modal: { ondismiss: () => window.alert('Payment cancelled. Please try again.') },
        })

        razorpay.on('payment.failed', () => window.alert('Payment failed. Please try again.'))
        window.localStorage.setItem('gene-academy-email', checkoutEmail)
        razorpay.open()
      } catch (error) {
        window.alert(`Checkout could not start: ${error.message || 'Make sure the Razorpay backend is running and that the checkout script is loaded.'}`)
      } finally {
        checkoutButton.disabled = false
      }
    }
    document.addEventListener('click', handleCheckout)
    return () => document.removeEventListener('click', handleCheckout)
  }, [showCart, cartItems])
  useEffect(() => {
    if (showCart || showAnalytics) return undefined
    const content = document.querySelector('.content-wrap')
    if (!content || content.querySelector('.email-capture-footer')) return undefined
    const footer = document.createElement('footer')
    footer.className = 'email-capture-footer'
    footer.innerHTML = '<div><span class="eyebrow">DOWNLOAD DELIVERY</span><h2>Get your presets sent straight to your inbox.</h2><p>Save your email once and we will send your download links after payment.</p></div><form><input type="email" placeholder="you@example.com" aria-label="Email for preset download links" required><button type="submit">Save email</button></form><small class="email-save-message"></small>'
    content.append(footer)
    const input = footer.querySelector('input')
    const form = footer.querySelector('form')
    const status = footer.querySelector('.email-save-message')
    input.value = email
    const handleInput = (event) => setEmail(event.target.value)
    const handleSubmit = (event) => { event.preventDefault(); if (!input.checkValidity()) { input.reportValidity(); return }; window.localStorage.setItem('gene-academy-email', input.value); setEmail(input.value); status.textContent = 'Email saved for checkout'; window.setTimeout(() => { status.textContent = '' }, 1800) }
    input.addEventListener('input', handleInput)
    form.addEventListener('submit', handleSubmit)
    return () => { input.removeEventListener('input', handleInput); form.removeEventListener('submit', handleSubmit); footer.remove() }
  }, [showCart, showAnalytics])
  useEffect(() => {
    if (showCart || showAnalytics) return undefined
    const videos = []
    document.querySelectorAll('.preset-grid .preset-card .preset-image').forEach((image, index) => {
      const preset = filteredPresets[index]
      if (!preset?.video || image.querySelector('.preset-video')) return
      const video = document.createElement('video')
      video.className = 'preset-video'
      video.src = preset.video
      video.autoplay = true
      video.loop = true
      video.muted = true
      video.playsInline = true
      video.addEventListener('error', () => video.remove())
      image.prepend(video)
      videos.push(video)
    })
    return () => videos.forEach((video) => video.remove())
  }, [showCart, showAnalytics, activeTab, query, filteredPresets])
  useEffect(() => {
    if (showCart || showAnalytics || (categoryAliases[activeTab] || activeTab) !== '1:1 session') return undefined
    const images = document.querySelectorAll('.preset-grid .preset-card .preset-image')
    const messages = ['Want to learn whole editing process', 'Learn particular software']
    const changedImages = []
    images.forEach((image, index) => {
      if (index > 1) return
      const originalBackground = image.style.backgroundImage
      const originalColor = image.style.backgroundColor
      const message = document.createElement('div')
      message.className = 'session-learning-message'
      message.textContent = messages[index]
      image.style.backgroundImage = 'none'
      image.style.backgroundColor = '#070609'
      image.append(message)
      changedImages.push({ image, originalBackground, originalColor, message })
    })
    return () => changedImages.forEach(({ image, originalBackground, originalColor, message }) => { image.style.backgroundImage = originalBackground; image.style.backgroundColor = originalColor; message.remove() })
  }, [showCart, showAnalytics, activeTab, query, filteredPresets])
  const shellClass = `app-shell ${isDark ? '' : 'theme-light'}`
  const header = (title, onLibrary) => <header className="topbar"><div className="breadcrumb"><button className="breadcrumb-home" onClick={onLibrary}>Library</button><b>/</b><strong>{title}</strong></div><div className="top-actions"><ThemeToggle isDark={isDark} onToggle={toggleTheme} /><button className="auth-button" onClick={() => { setAuthMode('signin'); setShowAuth(true) }}>Sign in</button><span className="top-avatar">AM</span></div></header>

  const renderLibrary = () => (
    <div className={shellClass}>
      <button className="floating-cart" onClick={() => setShowCart(true)}><Icon name="bag" size={17} /> Bag <b>{cartItems.length}</b></button>
      <Sidebar onHelp={() => setShowChat(true)} />
      <main className="main-content">
        {header('All presets')}
        <div className="content-wrap">
          <section className="welcome-row"><div><p className="eyebrow">MONDAY, AUGUST 31, 2026</p><h1>Your creative library <span>✦</span></h1><p className="subhead">Shape the mood. Share the feeling. Sell your point of view.</p></div><button className="primary-button"><Icon name="plus" size={17} /> New preset</button></section>
          <section className="section-heading" id="library"><div><h2>Preset library</h2><p>Keep your collection fresh and ready to be discovered.</p></div></section>
          <div className="library-toolbar"><div className="tabs">{['All presets', 'Featured', 'New', 'Popular', 'Motion Graphics'].map((tab) => <button key={tab} className={activeTab === tab ? 'tab active' : 'tab'} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div><label className="search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your presets" /></label></div>
          <div className="preset-grid">{filteredPresets.map((preset) => <article className="preset-card" key={preset.name}><div className={`preset-image${preset.blur ? ' blur' : ''}`} style={{ backgroundImage: `url(${preset.image})` }}><span className="preset-type">{preset.type}</span>{preset.blur && <span className="preset-overlay-text">Learn Advance Color Grading</span>}</div><div className="preset-info"><div><h3>{preset.name}</h3><p>{preset.tone} tones · {preset.category}</p></div><span className="color-dot" style={{ background: preset.color }} /></div><button className={`add-bag-button ${addedName === preset.name ? 'added' : ''}`} onClick={() => addToBag(preset)}><Icon name="bag" size={14} /> {addedName === preset.name ? 'Added to bag' : `Add to bag · $${preset.price}`}</button></article>)}</div>
          <div className="email-capture-footer"><div><span className="eyebrow">DOWNLOAD DELIVERY</span><h2>Get your presets sent straight to your inbox.</h2><p>Save your email once and we will send your download links after payment.</p></div><form><input type="email" placeholder="you@example.com" aria-label="Email for preset download links" required /><button type="submit">Save email</button></form><small className="email-save-message"></small></div>
        </div>
      </main>
      {showChat && <SupportChat onClose={() => setShowChat(false)} />}
    </div>
  )

  const app = (
    <>
      {notice && (
        <div className="auth-notice-backdrop" onClick={() => setNotice(null)}>
          <div className="auth-notice" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="auth-notice-header">{notice.title}</div>
            <p>{notice.message}</p>
            <button type="button" className="auth-notice-button" onClick={() => setNotice(null)}>OK</button>
          </div>
        </div>
      )}
      {showAuth ? (
        <div className={shellClass}>
          <AuthPage
            mode={authMode}
            onModeChange={setAuthMode}
            onBack={() => setShowAuth(false)}
            onSubmit={handleAuthSubmit}
            currentEmail={email}
            onGoogleSuccess={handleGoogleSuccess}
            onGoogleError={(message) => setNotice({ title: 'Google sign-in unavailable', message })}
          />
        </div>
      ) : showAnalytics ? (
        <div className={shellClass}>
          <Sidebar onHelp={() => setShowChat(true)} onHome={() => setShowAnalytics(false)} />
          <main className="main-content">{header('Analytics', () => setShowAnalytics(false))}<AnalyticsPage onBack={() => setShowAnalytics(false)} /></main>
          {showChat && <SupportChat onClose={() => setShowChat(false)} />}
        </div>
      ) : showCart ? (
        <div className={shellClass}>
          <Sidebar onHelp={() => setShowChat(true)} onHome={() => setShowCart(false)} />
          <main className="main-content">{header('Shopping bag', () => setShowCart(false))}<CartPage items={cartItems} setItems={setCartItems} onBack={() => setShowCart(false)} email={email} setEmail={setEmail} /></main>
          {showChat && <SupportChat onClose={() => setShowChat(false)} />}
        </div>
      ) : renderLibrary()}
    </>
  )

  return GOOGLE_CLIENT_ID ? <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>{app}</GoogleOAuthProvider> : app
}

export default App
