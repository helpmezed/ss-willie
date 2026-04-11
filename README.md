# Xeno-Comm Interstellar Dispatch

A Deep Space-themed live news aggregator. Earth's headlines, intercepted and translated for the galaxy.

---

## Local Setup

### 1. Clone / download the project
```bash
cd ss-willie
npm install
```

### 2. Add your NewsAPI key
Get a free key at **https://newsapi.org** -> Get API Key

Then create a `.env` file (copy from the example):
```bash
cp .env.example .env
```
Open `.env` and replace `your_key_here` with your actual key:
```
NEWS_API_KEY=abc123yourkeyhere
```

### 3. Run it locally
```bash
npm start
```
Then open **http://localhost:3000** in your browser.

---

## Deploy to GitHub + Render

### Step 1 -- Push to GitHub
1. Create a new repo on [github.com](https://github.com) (name it `ss-willie` or anything you like)
2. In your project folder, run:
```bash
git init
git add .
git commit -m "Xeno-Comm Interstellar Dispatch launch"
git branch -M main
git remote add origin https://github.com/helpmezed/ss-willie.git
git push -u origin main
```

### Step 2 -- Deploy on Render
1. Go to **https://render.com** and sign in
2. Click **"New +"** -> **"Web Service"**
3. Connect your GitHub repo
4. Fill in the settings:
   - **Name**: `ss-willie` (or whatever you like)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free
5. Click **"Advanced"** -> **"Add Environment Variable"**:
   - Key: `NEWS_API_KEY`
   - Value: *(paste your NewsAPI key)*
6. Click **"Create Web Service"**

Render will build and deploy -- usually takes 1-2 minutes.
Your live URL will be something like: `https://ss-willie.onrender.com`

---

## Project Structure
```
ss-willie/
├── server.js          <- Node.js proxy server
├── package.json
├── .env.example       <- Copy this to .env and add your key
├── .gitignore         <- Keeps .env out of GitHub (important!)
└── public/
    └── index.html     <- The app itself
```

---

## Important Notes
- **Never commit your `.env` file** -- the `.gitignore` protects you
- On Render's free plan, the server "sleeps" after 15 minutes of inactivity -- first load may take 30 seconds to wake up
- NewsAPI free tier only allows requests from a server (not a browser directly) -- that's why the Node proxy is needed
