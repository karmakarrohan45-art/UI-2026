import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { LoginPage, ProtectedComponent, UserProfile, LogoutButton } from './auth-components'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000'
const RAZORPAY_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_TU4StmDDGZTVxu'

// ... (keep your existing presets, Icon, ThemeToggle, SupportChat components)

function App() {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })

  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark'
  })

  // Save theme preference
  useEffect(() => {
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const handleLoginSuccess = (userData) => {
    setUser(userData)
  }

  const handleLogoutSuccess = () => {
    setUser(null)
  }

  // If user is not logged in, show login page
  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  // If user is logged in, show main app
  return (
    <ProtectedComponent>
      <div className="app-container">
        <header className="app-header">
          <div className="header-left">
            <h1>Gene Academy Storefront</h1>
          </div>
          <div className="header-right">
            <UserProfile user={user} />
            <button onClick={() => setIsDark(!isDark)} className="theme-toggle">
              {isDark ? '☼' : '☾'}
            </button>
            <LogoutButton onLogoutSuccess={handleLogoutSuccess} />
          </div>
        </header>

        <main className="app-main">
          {/* Your existing app content goes here */}
          <div className="content">
            <h2>Welcome, {user.name}!</h2>
            <p>Browse our presets and courses below.</p>
            {/* Add your presets grid, products, etc. here */}
          </div>
        </main>
      </div>
    </ProtectedComponent>
  )
}

export default App
