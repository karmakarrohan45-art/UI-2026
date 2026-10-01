import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import { useState } from 'react'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000'
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export function LoginPage({ onLoginSuccess }) {
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setLoading(true)
      setError(null)

      const response = await axios.post(
        `${API_BASE_URL}/auth/google`,
        {
          token: credentialResponse.credential,
        },
        {
          withCredentials: true, // Important for cookies
        }
      )

      // Store user data
      localStorage.setItem('user', JSON.stringify(response.data.user))
      localStorage.setItem('access_token', response.data.access_token)

      // Call success callback
      onLoginSuccess(response.data.user)
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Please try again.')
      console.error('Login error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleError = () => {
    setError('Google login failed. Please try again.')
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="login-container">
        <div className="login-box">
          <h1>Welcome back</h1>
          <p>Sign in to your account</p>

          {error && <div className="error-message">{error}</div>}

          <div className="google-login-wrapper">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              text="signin_with"
              size="large"
              locale="en"
            />
          </div>

          <div className="divider">
            <span>or</span>
          </div>

          <form className="email-login">
            <input type="email" placeholder="Email address" required />
            <input type="password" placeholder="Password" required />
            <button type="submit" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in with email'}
            </button>
          </form>

          <p className="signup-link">
            Don't have an account? <a href="/signup">Create one</a>
          </p>
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}

export function ProtectedComponent({ children, requiredRole = null }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })

  if (!user) {
    return <div className="unauthorized">Please log in first</div>
  }

  if (requiredRole && user.role !== requiredRole) {
    return <div className="unauthorized">You don't have permission to view this</div>
  }

  return children
}

export function UserProfile({ user }) {
  return (
    <div className="user-profile">
      <img src={user.picture} alt={user.name} className="avatar" />
      <div>
        <h3>{user.name}</h3>
        <p>{user.email}</p>
      </div>
    </div>
  )
}

export function LogoutButton({ onLogoutSuccess }) {
  const handleLogout = async () => {
    try {
      await axios.post(
        `${API_BASE_URL}/auth/logout`,
        {},
        {
          withCredentials: true,
        }
      )

      // Clear local storage
      localStorage.removeItem('user')
      localStorage.removeItem('access_token')

      onLogoutSuccess()
    } catch (err) {
      console.error('Logout error:', err)
    }
  }

  return <button onClick={handleLogout} className="logout-btn">Log out</button>
}
