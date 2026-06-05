# Skip the River

A multiplayer card game. Play against bots offline, or share a room code for online play.

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env.local
# Fill in your Firebase credentials in .env.local

# 3. Start dev server
npm run dev
# → http://localhost:5173
```

## First-time Firebase Setup

### 1. Create a Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `skip-the-river`) → Create
3. In the project, go to **Build → Realtime Database** → Create database
   - Start in **test mode** (you can tighten rules later)
   - Choose a region close to your users
4. In the project, go to **Build → Hosting** → Get started (just click through)
5. Go to **Project Settings → Your apps → Add app → Web**
   - Register the app, copy the `firebaseConfig` object
   - Fill those values into `.env.local` (and into GitHub Secrets for CI/CD)

### 2. Update `.firebaserc`
Replace `YOUR_FIREBASE_PROJECT_ID` with your actual project ID:
```json
{ "projects": { "default": "skip-the-river-abc12" } }
```

### 3. Deploy manually (first time)
```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy
```

---

## GitHub → Firebase CI/CD (auto-deploy on push)

### 1. Create a Firebase service account
```bash
firebase init hosting:github
# Follow the prompts — it creates the service account and adds the
# FIREBASE_SERVICE_ACCOUNT secret to your GitHub repo automatically.
```
Or manually: **Firebase Console → Project Settings → Service accounts →
Generate new private key** → save the JSON.

### 2. Add secrets to GitHub
Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add all of these:

| Secret name | Where to find it |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | The JSON key from step 1 (paste the entire file contents) |
| `VITE_FIREBASE_API_KEY` | Firebase project settings → SDK config |
| `VITE_FIREBASE_AUTH_DOMAIN` | same |
| `VITE_FIREBASE_DATABASE_URL` | same |
| `VITE_FIREBASE_PROJECT_ID` | same |
| `VITE_FIREBASE_STORAGE_BUCKET` | same |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | same |
| `VITE_FIREBASE_APP_ID` | same |

### 3. Push to `main`
Every push to `main` will now automatically build and deploy. Done.

---

## Architecture

| Feature | How it works |
|---|---|
| Bots mode | Pure client-side. No network needed. |
| Online multiplayer | Firebase Realtime Database stores shared game state. Clients poll every 1.5s. |
| Player ID / name | Stored in `localStorage` on each device. |

## Database Rules

The default `database.rules.json` allows open read/write to the `str/` path (game rooms).
For a production app you'd want to tighten these — but for a card game among friends this is fine.
