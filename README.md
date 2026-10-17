# Ecom Efficiency · Tickets Bot + AI Support Agent

Discord first-line support assistant powered by Claude, with intelligent general chat monitoring and a web dashboard to inspect every conversation in real time.

## What it does

### Ticket Support (Existing)
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

### AI Support Agent (NEW)
- **Learns from history**: Automatically extracts Q&A pairs from past conversations where staff/Antoine answered questions.
- **Monitors general chat**: Watches enabled channels for questions and responds when confident (≥70% confidence threshold).
- **Confidence-based responses**: Only replies when the answer is well-supported by FAQ and learned knowledge.
- **Smart escalation**: Sends low-confidence questions to a staff alert channel instead of guessing.
- **Respects staff**: Never replies when staff is already active in the conversation.
- **Rate limiting**: Self-limits to prevent spam (max 10 replies/hour globally, 3 per channel/hour, 1 minute between replies).
- **Sensitive topic detection**: Automatically escalates refunds, billing, bans, legal issues, and partnerships.
- **Per-channel control**: Enable/disable monitoring on specific channels.
- **Kill switch**: Global enable/disable control for emergencies.

## Local dev

```bash
cd source
cp .env.example .env   # then fill in the values
npm install
npm start
```


Dashboard: http://localhost:1500

## Setting up the AI Support Agent

The AI Support Agent monitors general chat channels and responds to member questions automatically when confident. Here's how to activate it:

### 1. Configure the staff alert channel

First, create a private channel for staff alerts (e.g., `#ai-alerts` or `#staff-notifications`). This is where the bot will send low-confidence questions that need human review.

Get the channel ID:
1. Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
2. Right-click the alert channel → Copy ID
3. Add to your `.env` or Railway variables:
   ```
   AI_AGENT_STAFF_ALERT_CHANNEL_ID=your_channel_id_here
   ```

### 2. Run the initial knowledge base extraction

After the bot starts, it will automatically extract Q&A pairs from message history. You can trigger a manual rebuild:

```
/agent-rebuild-qa
```

This scans all channels the bot can read, looking for patterns where:
- A member asks a question
- Staff/Antoine responds

The bot learns from these exchanges and uses them to answer similar questions later.

### 3. Enable the agent and add channels

```
/agent-enable
/agent-channel-add channel:#general
/agent-channel-add channel:#support-français
```

Add any channels where you want the bot to monitor questions. The bot will:
- Only reply when confident (≥70% confidence)
- Never reply if staff is already active
- Respect rate limits (won't spam)
- Escalate sensitive topics (refunds, billing, bans, etc.) to the alert channel

### 4. Monitor and adjust

Check the status anytime:
```
/agent-status
```

This shows:
- Global enable/disable state
- Number of Q&A pairs learned
- Which channels are monitored
- Reply activity (last hour)
- Staff alert channel

### 5. Emergency kill switch

If the bot ever misbehaves:
```
/agent-disable
```

This immediately stops all general chat monitoring (ticket support continues normally).

### How it works

**Confidence scoring**: Before replying, the bot rates its confidence from 0-100%. If confidence is below 70%, it sends an alert to the staff channel instead of replying publicly.

**Rate limiting**: The bot will never send more than:
- 10 replies per hour globally
- 3 replies per hour per channel
- 1 reply per minute in any channel

**Staff detection**: The bot checks the last 5 messages before replying. If any are from staff/Antoine in the last 5 minutes, it stays silent.

**Sensitive topics**: Questions containing keywords like "refund", "ban", "billing", "payment", "legal", etc. are automatically escalated to staff, never answered by the bot.

### Recommended workflow

1. **Start conservative**: Enable monitoring in 1-2 busy channels first (like `#general`).
2. **Watch the alert channel**: Review low-confidence questions. Use `/teach` to add answers for common questions the bot isn't confident about yet.
3. **Expand gradually**: Once you're happy with the response quality, add more channels.
4. **Periodic review**: Check `/agent-status` weekly to see activity. Rebuild the Q&A base monthly or after major FAQ changes with `/agent-rebuild-qa`.

## Slash commands (admin)

### Ticket AI Commands
- `/ai-toggle state:on|off` — pause/resume the AI in the current ticket.
- `/reindex-knowledge` — rebuild the channel knowledge base now (also runs at
  startup and every 12 h).
- `/teach question:"..." answer:"..."` — teach the AI a new Q&A pair manually.

### AI Support Agent Commands (NEW)
- `/agent-enable` — enable the AI support agent globally.
- `/agent-disable` — disable the AI support agent (kill switch).
- `/agent-status` — show current status, enabled channels, and statistics.
- `/agent-channel-add channel:#general` — enable monitoring in a specific channel.
- `/agent-channel-remove channel:#general` — disable monitoring in a specific channel.
- `/agent-rebuild-qa` — rebuild the Q&A knowledge base from message history now (also runs automatically every 6 hours).

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
CLAUDE_MODEL=claude-3-5-haiku-20241022
TICKET_CHANNEL_PREFIX=ticket-
OWNER_USER_ID=your_discord_user_id
STAFF_ROLE_ID=optional_role_id
ECOM_AGENT_ROLE_ID=1244916325294542858
DASHBOARD_PASSWORD=a_strong_password_you_choose

# AI Support Agent (NEW)
# Create a private staff channel for low-confidence question alerts
AI_AGENT_STAFF_ALERT_CHANNEL_ID=your_staff_alert_channel_id

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

### Anthropic API (Claude 3.5 Haiku)

**Model used:** Claude 3.5 Haiku (`claude-3-5-haiku-20241022`)

With prompt caching enabled (already configured):

**Pricing:**
- Input: $0.80 / 1M tokens
- Output: $4.00 / 1M tokens
- Cached read: $0.08 / 1M tokens
- **~4x cheaper than Claude 3.5 Sonnet**

**Ticket Support Only** (~100 ticket messages/day):
- Estimated: **$4-5/month**

**With AI Support Agent** (~100 tickets + ~50 general chat replies/day):
- Estimated: **$7-13/month**

**Why Claude 3.5 Haiku is perfect:**
- ✅ 3.75x cheaper than Claude 3.5 Sonnet
- ✅ Very intelligent for Q&A and reasoning
- ✅ Fast responses (optimized for speed)
- ✅ Perfect for short, factual answers (1-3 sentences)
- ✅ Excellent reasoning from knowledge base
- ✅ Rate limiting prevents runaway costs

**Cost monitoring tips:**
- Check your Anthropic dashboard usage weekly during the first month
- With Claude 3.5 Haiku, costs are very reasonable (~$10-15/month)
- If you need more detailed/nuanced responses, you can upgrade to `CLAUDE_MODEL=claude-3-5-sonnet-20241022`

See [COST_ESTIMATION_HAIKU.md](COST_ESTIMATION_HAIKU.md) for detailed pricing breakdown.

### Railway hosting

Railway Hobby plan: **$5/month** for the bot service (unchanged).

### Total estimated cost

- **Conservative** (tickets only, agent disabled): **$9-10/month** ⭐
- **Recommended** (tickets + agent in 2-3 channels): **$12-14/month** ⭐⭐⭐
- **Heavy usage** (agent in many channels): **$15-16/month**
- **Absolute maximum** (rate limited): **$38/month**

**Compared to alternatives:**
- Intercom AI: $99-$499/month → **Saves $85-$484/month**
- Zendesk AI: $50-$200/month → **Saves $36-$185/month**

## Discord Permissions & Intents

The bot requires these Discord intents (already configured in `index.js`):
- `Guilds` — read server/channel structure
- `GuildMessages` — read messages in channels
- `MessageContent` — read message text (privileged intent)
- `GuildMembers` — check user roles

**Important**: The `MessageContent` intent is **privileged**. To enable it:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → Bot tab
3. Scroll to "Privileged Gateway Intents"
4. Enable "Message Content Intent"
5. Save changes

Without this intent, the bot cannot read message text and will not work.

**Bot permissions** (invite link):
- Read Messages/View Channels
- Send Messages
- Read Message History
- Add Reactions (for future reaction-based corrections)
- Manage Roles (only if using the audit/remove cancelled agents commands)
