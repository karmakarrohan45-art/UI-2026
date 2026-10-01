# Google OAuth Authentication Setup Guide

## Step 1: Get Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google+ API:
   - Search for "Google+ API" in the APIs section
   - Click Enable
4. Create OAuth 2.0 credentials:
   - Go to "Credentials" tab
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - `http://localhost:5173` (Vite dev server)
     - `http://localhost:5000/auth/google/callback` (backend)
     - `http://localhost:5177` (production local)
     - Your actual production domain
   - Copy your **Client ID** and **Client Secret**

## Step 2: Install Dependencies

### Frontend (React):
```bash
npm install @react-oauth/google axios
```

### Backend (Python):
```bash
pip install google-auth-oauthlib google-auth-httplib2 python-dotenv
```

## Step 3: Update .env files

### Frontend - Create or update `.env`:
```
VITE_API_BASE_URL=http://127.0.0.1:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
```

### Backend - Update `.env`:
```
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
SECRET_KEY=your_flask_secret_key_here
```

## Step 4: Frontend Implementation

See `auth-components.jsx` file for complete frontend components.

## Step 5: Backend Implementation

See `auth-routes.py` file for complete backend routes.

## Step 6: Update App.jsx

Replace your current App.jsx with the authentication flow integrated.

## Testing

1. Start backend: `python -m flask --app app.py run`
2. Start frontend: `npm run dev`
3. Navigate to `http://localhost:5173`
4. Click "Login with Google"
5. You should see the authentication dialog
6. After successful login, you'll be redirected and have a user session

## Security Notes

- Never commit `.env` files with real credentials
- Use environment variables in production (Vercel, Heroku, etc.)
- Validate tokens on backend every time
- Use HTTPS in production
- Set `SameSite=Strict` for cookies
