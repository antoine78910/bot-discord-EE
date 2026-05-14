# Ecom Efficiency · Tickets Bot

Discord first-line support assistant powered by Claude, with a web dashboard
to inspect every ticket conversation in real time.

## What it does

- **Greets** every new ticket channel (any channel whose name starts with `ticket-`).
- **Reads** the FAQ (`source/data/faq.md`) and an auto-generated knowledge base
  built from your public Discord channels.
- **Replies** in the user's language (FR / EN / etc.), in 1-3 short sentences.
- **Reads screenshots** attached in tickets and passes them to Claude vision when members send image attachments.
- **Detects cancellation intent** and answers with a fixed message — with an
  extra price-warning paragraph for users who hold the `Ecom Agent` role.
- **Redirects OTP/code requests** to the app instead of sending OTP codes inside ticket replies.
- **Pings you** (`OWNER_USER_ID`) when it doesn't know what to answer, when
  the user asks for a human, or in case of any error.
- **Logs everything** to `data/tickets-history.json` and exposes a web dashboard
  on the configured `PORT` showing all tickets, conversations and stats.

## Local dev

```bash
cd source
cp .env.example .env   # then fill in the values
npm install
npm start
```

Dashboard: http://localhost:1500

## Slash commands (admin)

- `/ai-toggle state:on|off` — pause/resume the AI in the current ticket.
- `/reindex-knowledge` — rebuild the channel knowledge base now (also runs at
  startup and every 12 h).

---

## Deploy to Railway (24/7 hosting)

### 1. Push the repo to GitHub

```bash
git init
git add .
git commit -m "Initial commit: ticket AI bot + dashboard"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

> The provided `.gitignore` already excludes `.env`, `node_modules`, the local
> backup `.zip`, and the runtime data files — secrets and history stay private.

### 2. Create a Railway project

1. Go to <https://railway.app> and click **New Project → Deploy from GitHub repo**.
2. Pick your newly pushed repo.
3. Railway reads `railway.json` and builds the included `Dockerfile`, which
   installs only production dependencies and runs `node index.js`.

### 2b. Vérifier le déploiement (souvent la cause si « rien sur Railway »)

- **Un seul `DISCORD_BOT_TOKEN` actif** : Discord n’autorise qu’**une** connexion
  gateway par token. Si tu lances `cd source && npm start` sur ton PC avec le
  même token que Railway, **c’est ton PC qui tient la session** : Railway se
  fait déconnecter (ou l’inverse). Arrête le bot local pour que Railway reste
  en ligne et exécute `ensureAdspowerOtpPanel` (message « Get the code »).
- **Root Directory** : dans Railway → service → **Settings**, le champ *Root
  Directory* doit rester **vide** (racine du repo = là où est le `Dockerfile`).
- **Start command** : avec le Dockerfile du repo, ne force pas un *Custom Start
  Command* qui lancerait autre chose que `node index.js` (laisser vide pour
  utiliser le `CMD` du Dockerfile).
- **Logs** : après déploiement, cherche `[BOOT] Running on Railway` dans les
  logs du service. Si tu vois plutôt *Running outside Railway*, ce conteneur
  n’est pas celui de Railway (ou les variables `RAILWAY_*` ne sont pas là).
  Cherche aussi `[BOT] Shard disconnected` si la session saute souvent.

### 3. Add the environment variables

In the Railway service, open **Variables → Raw Editor** and paste:

```
DISCORD_BOT_TOKEN=your_token
DISCORD_SERVER_ID=your_guild_id
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-5
TICKET_CHANNEL_PREFIX=ticket-
OWNER_USER_ID=your_discord_user_id
STAFF_ROLE_ID=optional_role_id
ECOM_AGENT_ROLE_ID=1244916325294542858
DASHBOARD_PASSWORD=a_strong_password_you_choose

# AdsPower Discord button → Next.js /admin tracking (REQUIRED or clicks are not saved)
# Use your real production URL (https, no trailing slash before /api).
ACTIVITY_TRACK_URL=https://ecomefficiency.com/api/activity/track-event
# Must match Vercel env ACTIVITY_TRACK_BOT_SECRET exactly (generate e.g. openssl rand -hex 32).
ACTIVITY_TRACK_BOT_SECRET=your_long_random_secret_same_as_vercel
```

> Do **not** set `PORT` — Railway injects it automatically and the bot reads it.

**Vercel (Next app, same project as Supabase `ip_events`):** add **only**  
`ACTIVITY_TRACK_BOT_SECRET` = the **same** string as in Railway above.  
Redeploy Production after saving variables.

If either variable is missing on Railway, logs show  
`ACTIVITY_TRACK_URL_set: false` or `ACTIVITY_TRACK_BOT_SECRET_set: false`.

### 4. Generate a public URL

In the Railway service, **Settings → Networking → Generate Domain**.
You'll get something like `https://your-bot.up.railway.app`. That's your
dashboard URL. Open it, log in with `admin` + the password you picked.

### 5. (Optional) Persist ticket history across redeploys

Railway containers have ephemeral disks by default. Without persistence, every
redeploy resets `tickets-history.json` (the knowledge file rebuilds itself
automatically from Discord at startup, no problem there).

To keep ticket history forever:

1. In Railway, **Settings → Volumes → Add Volume**.
2. Mount path: `/app/data`.
3. Add an env variable: `DATA_DIRECTORY=/app/data`.
4. Redeploy. From now on, tickets history persists across deploys.

### 6. Re-deploy on every code push

Railway auto-deploys from `main` by default. Edit `source/data/faq.md` locally,
push to `main`, and the bot picks up the new FAQ on the next deploy
(or run `/reindex-knowledge` from Discord to refresh the knowledge base
without redeploying).

---

## Project layout

```
.
├── Dockerfile                # Builds the production image (used by Railway)
├── .dockerignore
├── railway.json              # Railway build/deploy config
├── .gitignore
├── README.md
└── source/
    ├── index.js              # Discord bot + Express dashboard
    ├── package.json
    ├── .env.example
    ├── data/
    │   └── faq.md            # Editable FAQ (committed)
    └── dashboard/            # Web UI (HTML + CSS + vanilla JS)
        ├── index.html
        ├── styles.css
        └── app.js
```

## Costs

With prompt caching enabled (already on) and ~100 messages per day, using
Claude Sonnet 4.5, expect roughly **$10-20/month** in Anthropic costs.

Railway Hobby plan: $5/month for the bot service.
