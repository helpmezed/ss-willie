# Xeno-Comm Interstellar Dispatch

A Deep Space-themed live chat + news aggregator. Earth's headlines, intercepted and translated for the galaxy.

---

## Local Setup

### 1. Clone / download the project
```bash
cd ss-willie
npm install
```

### 2. Add your keys
Copy the example env file and fill in your values:
```bash
cp .env.example .env
```
Open `.env` and add your keys:
```
PUSHER_APP_ID=your_pusher_app_id
PUSHER_KEY=your_pusher_key
PUSHER_SECRET=your_pusher_secret
PUSHER_CLUSTER=your_pusher_cluster
NEWS_API_KEY=your_newsapi_key
```

**Where to get them:**
- Pusher keys → [dashboard.pusher.com](https://dashboard.pusher.com) → your app → App Keys
- NewsAPI key → [newsapi.org](https://newsapi.org) → Get API Key

### 3. Run it locally
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

---

## Deploy to Vercel

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/helpmezed/ss-willie.git
git push -u origin main
```

### Step 2 — Connect to Vercel
1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New Project"** and import your GitHub repo
3. Click **"Deploy"** — the first deploy will fail (no keys yet, that's fine)

### Step 3 — Add environment variables
1. Go to your project → **Settings** → **Environment Variables**
2. Add each of these (make sure **Production** is checked for each):

| Key | Value |
|-----|-------|
| `PUSHER_APP_ID` | from Pusher dashboard |
| `PUSHER_KEY` | from Pusher dashboard |
| `PUSHER_SECRET` | from Pusher dashboard |
| `PUSHER_CLUSTER` | from Pusher dashboard (e.g. `us2`) |
| `NEWS_API_KEY` | from newsapi.org |

### Step 4 — Redeploy
After saving the env vars, push any commit to trigger a fresh deployment that picks them up.

---

## Project Structure
```
ss-willie/
├── relay.js           <- Interstellar relay server (Node.js / Express)
├── package.json
├── vercel.json        <- Vercel deployment config
├── .env.example       <- Copy this to .env and fill in your keys (never commit .env)
├── .gitignore         <- Keeps .env out of GitHub
└── terminal/
    └── index.html     <- The broadcast terminal (the app itself)
```

---

## Important Notes
- **Never commit your `.env` file** — `.gitignore` protects you, but double-check
- Keys must be added under the **Production** environment in Vercel, not just Preview/Development
- NewsAPI free tier only allows server-side requests — that's why the relay server exists
