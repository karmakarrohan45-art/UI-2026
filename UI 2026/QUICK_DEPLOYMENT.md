# Quick Deployment Steps (5 minutes)

## Step 1: Deploy Frontend to Vercel

### Install Vercel CLI
```bash
npm install -g vercel
```

### Login to Vercel
```bash
vercel login
```

### Deploy
```bash
cd "c:\Users\User\Desktop\all in one\UI 2026\appname"
vercel --prod
```

Your site will be at: `https://appname.vercel.app` (or custom name you choose)

---

## Step 2: Deploy Backend to Heroku

### Install Heroku CLI
Download from: https://devcenter.heroku.com/articles/heroku-cli

### Login
```bash
heroku login
```

### Create Heroku App
```bash
cd "c:\Users\User\Desktop\all in one\UI 2026\appname\backend"
heroku create your-app-name
```

Your backend will be at: `https://your-app-name.herokuapp.com`

### Set Environment Variables
```bash
heroku config:set GOOGLE_CLIENT_ID=your_google_client_id
heroku config:set GOOGLE_CLIENT_SECRET=your_google_client_secret
heroku config:set SECRET_KEY=random_secret_key_here
heroku config:set RAZORPAY_KEY_ID=rzp_test_1234567890
heroku config:set RAZORPAY_KEY_SECRET=demo_secret
```

### Deploy
```bash
git init
git add .
git commit -m "Deploy backend"
git push heroku main
```

---

## Step 3: Connect Frontend to Backend

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your **appname** project
3. Go to **Settings** → **Environment Variables**
4. Update **VITE_API_BASE_URL** to: `https://your-app-name.herokuapp.com`
5. Go to **Deployments** → Click the latest deployment → **Redeploy**

---

## Step 4: Update Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project → Credentials
3. Edit your OAuth 2.0 Client ID
4. Add these authorized redirect URIs:
   - `https://appname.vercel.app`
   - `https://your-app-name.herokuapp.com`
5. Save

---

## Step 5: Test It

1. Visit: `https://appname.vercel.app`
2. Add items to cart → refresh page → should still be there ✅
3. Try Google login
4. Try checkout

---

## If Heroku Free Tier Issues

Heroku removed free tier. Try alternatives:

### Railway (Recommended)
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub Repo"
4. Select your repo
5. Set environment variables
6. Auto-deploys on git push

### Render
1. Go to [render.com](https://render.com)
2. Sign up
3. Create "New Web Service"
4. Connect GitHub repo
5. Deploy

---

## Troubleshooting

### "API not connected" error on frontend
- Check Vercel env var `VITE_API_BASE_URL` is correct
- Make sure backend is deployed and running
- Redeploy frontend after updating env var

### Heroku deploy fails
- Run: `heroku logs --tail` to see error
- Make sure `Procfile` exists with: `web: gunicorn app:app`
- Make sure `gunicorn` is in requirements.txt

### Cart clears on refresh in production
- Check browser localStorage (F12 → Application → Local Storage)
- Should see `gene-academy-cart` with your items

### Google login not working
- Verify Client ID is in Vercel env vars
- Verify redirect URIs in Google Cloud Console
- Check browser console (F12) for errors

---

## That's it! 🎉

Your app is now live on the internet!
