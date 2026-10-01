# Vercel Deployment Guide

## Overview

Your app has two parts that need different hosting:
- **Frontend (React/Vite)** → Vercel ✅
- **Backend (Python/Flask)** → Heroku, Railway, or Render (Vercel doesn't support Python long-running servers)

---

## Part 1: Deploy Frontend to Vercel

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Create Vercel Project

In your project root (`appname/`):

```bash
vercel login
vercel
```

Follow the prompts:
- Link to existing project? **No**
- Set project name: **appname** (or your choice)
- Framework: **Vite**
- Root directory: **./** (current)
- Build command: **npm run build**
- Output directory: **./.vite/dist**

### Step 3: Configure Environment Variables for Frontend

```bash
vercel env add VITE_API_BASE_URL
# Enter your backend URL: https://your-backend.herokuapp.com (you'll add this later)

vercel env add VITE_GOOGLE_CLIENT_ID
# Enter: your_google_client_id_here
```

Or configure in Vercel Dashboard:
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add:
   - `VITE_API_BASE_URL` = `https://your-backend-url.com`
   - `VITE_GOOGLE_CLIENT_ID` = `your_client_id`

### Step 4: Deploy Frontend

```bash
vercel --prod
```

Your frontend will be live at: `https://appname.vercel.app`

---

## Part 2: Deploy Backend to Heroku

### Why Heroku for Backend?
- Supports Python/Flask natively
- Free dyno tier available (with limitations)
- Easy integration with Flask apps

### Step 1: Install Heroku CLI

Download from: [heroku.com/download](https://www.heroku.com/download)

Or via npm:
```bash
npm install -g heroku
```

### Step 2: Create Heroku App

```bash
cd appname/backend
heroku login
heroku create your-app-name
```

Your backend will be at: `https://your-app-name.herokuapp.com`

### Step 3: Create Procfile

In `appname/backend/`, create file named **`Procfile`** (no extension):

```
web: gunicorn app:app
```

### Step 4: Update requirements.txt

Add gunicorn to `appname/backend/requirements.txt`:

```
Flask==3.0.3
Flask-Cors==4.0.1
pytest==8.3.2
python-dotenv==1.0.1
razorpay==2.0.1
google-auth==2.26.1
google-auth-httplib2==0.2.0
google-auth-oauthlib==1.2.0
PyJWT==2.8.1
gunicorn==21.2.0
```

### Step 5: Set Environment Variables on Heroku

```bash
heroku config:set GOOGLE_CLIENT_ID=your_client_id
heroku config:set GOOGLE_CLIENT_SECRET=your_client_secret
heroku config:set SECRET_KEY=your_random_secret_key
heroku config:set RAZORPAY_KEY_ID=rzp_test_1234567890
heroku config:set RAZORPAY_KEY_SECRET=demo_secret
```

Generate a random SECRET_KEY:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Step 6: Deploy to Heroku

```bash
git init
git add .
git commit -m "Initial commit"
git push heroku main
# Or: git push heroku master
```

### Step 7: Update Frontend API URL

Go back to Vercel Dashboard:
1. Select your **appname** project
2. **Settings** → **Environment Variables**
3. Update `VITE_API_BASE_URL` to: `https://your-app-name.herokuapp.com`
4. Redeploy: Click **Deployments** → **Redeploy**

---

## Alternative Backend Hosting (if Heroku free tier is full)

### Option A: Railway

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Create new project → Deploy from GitHub repo
4. Select your Flask app folder
5. Add environment variables
6. Auto-deploys on git push

### Option B: Render

1. Go to [render.com](https://render.com)
2. Sign up
3. Create **New Web Service**
4. Connect GitHub repo
5. Set build/start commands
6. Deploy

---

## Update Backend for Production

### Update CORS for Production URLs

In `appname/backend/app.py`:

```python
CORS(app, 
     origins=["https://appname.vercel.app", "http://localhost:5173"],
     supports_credentials=True)
```

### Update Session Config for Production

In `appname/backend/app.py`:

```python
app.config['SESSION_COOKIE_SECURE'] = True  # HTTPS only
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
```

---

## Update Google OAuth for Production

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Go to **Credentials**
4. Edit your OAuth 2.0 Client ID
5. Add authorized redirect URIs:
   ```
   https://appname.vercel.app
   https://your-app-name.herokuapp.com
   ```

---

## Testing Production Deployment

After deploying both:

1. Visit: `https://appname.vercel.app`
2. Try adding items to cart (should persist)
3. Try signing in with Google
4. Try checkout with Razorpay

---

## Quick Deployment Commands Cheatsheet

### Frontend (Vercel)
```bash
cd appname
vercel --prod
```

### Backend (Heroku)
```bash
cd appname/backend
git push heroku main
```

### Check Heroku Logs
```bash
heroku logs --tail
```

### Check Vercel Logs
Visit Vercel Dashboard → Deployments → Click deployment → Logs

---

## Troubleshooting

### Frontend shows "API not connected"
- Check `VITE_API_BASE_URL` in Vercel Environment Variables
- Verify backend is running: `curl https://your-app-name.herokuapp.com/api/health`
- Redeploy frontend after updating API URL

### Cart not persisting in production
- Clear browser cache
- Check localStorage in DevTools (F12 → Application → Local Storage)
- Try incognito/private window

### Google OAuth not working
- Verify OAuth credentials are added to Google Cloud Console
- Check that redirect URIs include your production domains
- Verify `VITE_GOOGLE_CLIENT_ID` matches Google Client ID

### 502 Bad Gateway on backend
- Check Heroku logs: `heroku logs --tail`
- Verify `Procfile` is in correct location
- Ensure `gunicorn` is in requirements.txt

### CORS errors
- Update `CORS(app, origins=[...])` to include your frontend domain
- Redeploy backend

---

## Continuous Deployment (Auto-deploy on git push)

### For Frontend (Vercel)
Already automatic! Pushes to main branch auto-deploy.

### For Backend (Heroku)
Connect Heroku to GitHub:
1. Heroku Dashboard → Settings → Deployment method → GitHub
2. Connect your repo
3. Enable automatic deploys from main branch

---

## Monitoring & Logs

### Vercel
- Dashboard → Deployments → Click deployment → Logs
- Real-time logs visible in dashboard

### Heroku
```bash
# View logs
heroku logs --tail

# View specific number of logs
heroku logs -n 50

# Filter logs
heroku logs --tail --dyno web
```

---

## Cost Estimate

- **Vercel Frontend**: Free tier (12GB bandwidth/month)
- **Heroku Backend**: Free tier ended (now starts at $7/month)
- **Alternative**: Railway ($5 credit/month free), Render (free tier available)

---

## Summary Checklist

- [ ] Frontend deployed to Vercel
- [ ] Backend deployed to Heroku/Railway/Render
- [ ] Environment variables set on both platforms
- [ ] Frontend API URL updated to production backend URL
- [ ] Backend CORS updated with production domain
- [ ] Google OAuth URIs updated in Google Cloud Console
- [ ] Tested cart persistence
- [ ] Tested Google login
- [ ] Tested checkout flow
