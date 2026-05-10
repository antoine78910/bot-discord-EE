# Ecom Efficiency · Tickets Bot

Discord first-line support assistant powered by Claude, with a web dashboard
to inspect every ticket conversation in real time.

## What it does

- **Greets** every new ticket channel (any channel whose name starts with `ticket-`).
- **Reads** the FAQ (`source/data/faq.md`) and an auto-generated knowledge base
  built from your public Discord channels.
- **Replies** in the user's language (FR / EN / etc.), in 1-3 short sentences.
- **Detects cancellation intent** and answers with a fixed message — with an
  extra price-warning paragraph for users who hold the `Ecom Agent` role.
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
3. Railway auto-detects the `railway.json` at the root and runs:
   ```
   cd source && npm install --omit=dev
   cd source && node index.js
   ```

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
DASHBOARD_PASSWORD=a_strong_password_you_choose
```

> Do **not** set `PORT` — Railway injects it automatically and the bot reads it.

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
