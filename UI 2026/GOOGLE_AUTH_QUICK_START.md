# Google OAuth Quick Start Guide

## Complete Step-by-Step Implementation

### Phase 1: Google Cloud Setup (5 minutes)

1. **Visit Google Cloud Console**
   - Go to https://console.cloud.google.com/
   - Sign in with your Google account
   - Create a new project (or use existing)

2. **Enable Google+ API**
   - Search "Google+ API" in the search bar
   - Click "Enable"

3. **Create OAuth Credentials**
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Select "Web application"
   - Name it (e.g., "Gene Academy App")

4. **Add Authorized Redirect URIs**
   Click "Add URI" and add these:
   ```
   http://localhost:5173
   http://localhost:5177
   http://localhost:3000
   http://localhost:5000
   ```
   
   For production, add:
   ```
   https://yourdomain.com
   https://yourdomain.com/auth/callback
   ```

5. **Copy Your Credentials**
   - Save the **Client ID** (looks like: `xxx-yyy.apps.googleusercontent.com`)
   - Save the **Client Secret** (keep this secret!)

---

### Phase 2: Install Dependencies (3 minutes)

#### Frontend
```bash
cd appname
npm install @react-oauth/google axios
```

#### Backend
```bash
cd appname/backend
pip install google-auth==2.26.1 google-auth-httplib2==0.2.0 google-auth-oauthlib==1.2.0 PyJWT==2.8.1
```

Or update requirements.txt and run:
```bash
pip install -r requirements.txt
```

---

### Phase 3: Configure Environment (3 minutes)

#### Frontend `.env` (create in `appname/` folder)
```
VITE_API_BASE_URL=http://127.0.0.1:5000
VITE_GOOGLE_CLIENT_ID=your_client_id_here
VITE_RAZORPAY_KEY_ID=rzp_test_TU4StmDDGZTVxu
```

#### Backend `.env` (create in `appname/backend/` folder)
```
SECRET_KEY=your_secret_key_here_make_this_random
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
RAZORPAY_KEY_ID=rzp_test_1234567890
RAZORPAY_KEY_SECRET=demo_secret
```

Generate a random SECRET_KEY with:
```python
import secrets
print(secrets.token_hex(32))
```

---

### Phase 4: Update Your Files (5 minutes)

The following files have been created/updated:

1. **Frontend files:**
   - `src/auth-components.jsx` - Authentication components
   - `src/auth.css` - Styling for auth UI
   - `src/App-with-auth.jsx` - Example App.jsx with auth integrated

2. **Backend files:**
   - `backend/auth_routes.py` - All authentication routes
   - `backend/app.py` - Updated to include auth routes

3. **Config files:**
   - `package.json` - Added @react-oauth/google and axios
   - `requirements.txt` - Added Google OAuth packages
   - `.env.example` - Template for environment variables

---

### Phase 5: Integrate Into Your App (10 minutes)

#### Option A: Replace Entire App.jsx (Recommended for starting fresh)

1. Copy content from `src/App-with-auth.jsx`
2. Replace content of `src/App.jsx`
3. Import the auth components at the top

#### Option B: Integrate Into Existing App.jsx (For existing projects)

1. Import the authentication components:
```jsx
import { LoginPage, ProtectedComponent, UserProfile, LogoutButton } from './auth-components'
```

2. Import the auth CSS:
```jsx
import './auth.css'
```

3. Add state for user:
```jsx
const [user, setUser] = useState(() => {
  const stored = localStorage.getItem('user')
  return stored ? JSON.parse(stored) : null
})
```

4. Wrap your app with authentication check:
```jsx
if (!user) {
  return <LoginPage onLoginSuccess={(userData) => setUser(userData)} />
}

return (
  <ProtectedComponent>
    {/* Your existing app content */}
  </ProtectedComponent>
)
```

---

### Phase 6: Start the Application (3 minutes)

#### Terminal 1: Start Backend
```bash
cd appname/backend
python -m flask --app app.py run
# Or: flask run
```

You should see:
```
* Running on http://127.0.0.1:5000
```

#### Terminal 2: Start Frontend
```bash
cd appname
npm run dev
```

You should see:
```
VITE v8.2.2  ready in 123 ms

➜  Local:   http://localhost:5173/
```

---

### Phase 7: Test the Login (2 minutes)

1. Open http://localhost:5173 in your browser
2. You should see the login page
3. Click "Sign in with Google"
4. A Google login popup should appear
5. Login with your Google account
6. You should be redirected to your app

---

## Troubleshooting

### "Google authentication is not connected yet" Error

**Cause:** Frontend not sending token to backend correctly

**Fix:**
1. Check your `VITE_GOOGLE_CLIENT_ID` in `.env`
2. Ensure backend is running on `http://127.0.0.1:5000`
3. Check browser console for errors (F12)
4. Verify CORS is enabled (it is by default with Flask-CORS)

### "Token verification failed" Error

**Cause:** Google Client ID mismatch

**Fix:**
1. Compare `VITE_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_ID` - they should match
2. Make sure they're actual Google OAuth credentials (not test keys)
3. Restart both frontend and backend after changing .env

### "CORS error"

**Fix:**
Backend already has CORS enabled. If you still get errors:
```python
CORS(app, 
     origins=["http://localhost:5173", "http://localhost:3000"],
     supports_credentials=True)
```

### Port Already in Use

If port 5000 or 5173 is in use:

For backend:
```bash
python -m flask --app app.py run --port 5001
```

For frontend (Vite):
```bash
npm run dev -- --port 5174
```

Then update `VITE_API_BASE_URL` accordingly.

---

## API Endpoints

### Authentication Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/google` | Authenticate with Google token |
| POST | `/auth/logout` | Logout user |
| GET | `/auth/me` | Get current user info (requires token) |
| POST | `/auth/verify` | Verify if token is valid |

### Example Requests

```javascript
// Login with Google
fetch('http://127.0.0.1:5000/auth/google', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ token: googleToken })
})

// Get current user
fetch('http://127.0.0.1:5000/auth/me', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
})

// Logout
fetch('http://127.0.0.1:5000/auth/logout', {
  method: 'POST',
  credentials: 'include'
})
```

---

## Next Steps

1. **Persist User Data**: Replace `users_db` dict with a real database (SQLite, PostgreSQL, MongoDB)
2. **Add User Roles**: Implement admin/user roles for authorization
3. **Email Verification**: Add email verification flow
4. **Session Management**: Add session refresh tokens
5. **Social Login**: Add GitHub, Microsoft, etc. login options
6. **User Profile**: Create user profile edit page
7. **Password Reset**: Add password reset functionality

---

## Security Checklist

- [ ] Never commit `.env` files with real credentials
- [ ] Use `https://` in production (not `http://`)
- [ ] Set `SECRET_KEY` to a random, long string
- [ ] Store tokens securely (httpOnly cookies or secure localStorage)
- [ ] Validate tokens on every API call
- [ ] Use environment variables for all secrets
- [ ] Implement rate limiting on auth endpoints
- [ ] Add CSRF protection for form submissions
- [ ] Log authentication events
- [ ] Implement account lockout after failed login attempts

---

## Production Deployment

### Frontend (Vercel)
```bash
vercel deploy
```
Update `.env.production` with production URLs

### Backend (Heroku/Railway)
```bash
# Set environment variables
heroku config:set GOOGLE_CLIENT_ID=xxx
heroku config:set GOOGLE_CLIENT_SECRET=yyy
heroku config:set SECRET_KEY=zzz

git push heroku main
```

---

## Support

For issues:
1. Check browser console (F12) for frontend errors
2. Check terminal for backend errors
3. Verify `.env` files have correct values
4. Ensure both servers are running
5. Check that Google OAuth credentials are valid
