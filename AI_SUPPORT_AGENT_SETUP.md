# AI Support Agent - Quick Setup Guide for Antoine

This guide walks you through activating the new AI Support Agent that will automatically answer member questions in your Discord server.

## What's New

The bot now has two modes:
1. **Ticket Support** (existing) - Responds in ticket channels
2. **AI Support Agent** (NEW) - Monitors general chat channels and answers questions automatically

## Initial Setup (One-Time)

### Step 1: Update Environment Variables

Add this to your Railway variables:

```
AI_AGENT_STAFF_ALERT_CHANNEL_ID=your_staff_channel_id
```

To get the channel ID:
1. Create a private channel in Discord for staff alerts (e.g., `#ai-alerts`)
2. Right-click the channel → Copy ID (you need Developer Mode enabled)
3. Paste it in Railway variables

### Step 2: Deploy the Update

The bot will automatically restart on Railway once you update the variables. Watch the logs for:

```
[AI-AGENT] Building Q&A knowledge base from message history...
[AI-AGENT] Q&A knowledge base built: X pairs in Xms
```

This means the bot has learned from your past conversations.

### Step 3: Enable the Agent

In Discord, run these commands:

```
/agent-enable
```

Then add channels you want to monitor. Start with 1-2 channels:

```
/agent-channel-add channel:#general
/agent-channel-add channel:#support-français
```

That's it! The bot is now monitoring those channels.

## How It Works

### The Bot Will:
✅ Only reply to questions (ignores statements, commands, short messages)
✅ Check its confidence before replying (must be ≥70%)
✅ Never reply if you or staff are already active in the thread
✅ Rate-limit itself (max 3 replies per hour per channel, 10 globally)
✅ Match the user's language (French → French, English → English)
✅ Learn from your answers and improve over time

### The Bot Will NOT:
❌ Reply to staff messages
❌ Answer refund/billing/ban questions (sends to alert channel instead)
❌ Spam or flood channels
❌ Reply when staff is already responding
❌ Answer if not confident (sends to alert channel instead)

### When Low Confidence

If the bot isn't confident about an answer, you'll get a notification in your staff alert channel:

```
⚠️ Low-confidence question in #general
Confidence: 45%
Question: How do I cancel my subscription?
[Jump to message]
```

You can then:
1. Answer manually in the channel
2. Use `/teach` to teach the bot the answer for next time

## Daily Usage

### Check Status
```
/agent-status
```

Shows:
- Is the agent enabled?
- How many Q&A pairs learned
- Which channels are monitored
- How many replies in the last hour

### Add/Remove Channels
```
/agent-channel-add channel:#new-channel
/agent-channel-remove channel:#old-channel
```

### Emergency Kill Switch

If the bot misbehaves:
```
/agent-disable
```

This immediately stops all general chat monitoring (ticket support continues).

Re-enable when ready:
```
/agent-enable
```

### Teaching the Bot

When you see a question the bot didn't answer (or answered incorrectly), teach it:

```
/teach question:"How do I reset my Midjourney credits?" answer:"Midjourney credits reset on the 14th of every month at 12:00 UTC+7."
```

The bot will use this answer next time someone asks a similar question.

### Rebuild Knowledge Base

After major FAQ updates or when you want the bot to relearn from recent conversations:

```
/agent-rebuild-qa
```

This scans message history and extracts Q&A pairs where you or staff answered questions.

## Monitoring & Optimization

### Week 1: Watch Closely
- Keep `/agent-status` open or check it daily
- Review your staff alert channel frequently
- Teach the bot answers for common low-confidence questions

### Week 2-3: Adjust
- If the bot is too quiet: it's being overly cautious. Most alerts should have good answers you can `/teach`.
- If the bot is too active: reduce channels or use `/agent-disable` temporarily.

### Month 2+: Hands-Off
- The bot should handle 60-80% of common questions
- You'll mainly see alerts for:
  - New/unusual questions
  - Sensitive topics (billing, refunds)
  - Edge cases

## Troubleshooting

### "The bot isn't replying at all"
1. Check `/agent-status` - is it enabled?
2. Is the channel added with `/agent-channel-add`?
3. Check if you or staff replied recently (bot stays silent when staff is active)

### "The bot is replying too much"
1. Use `/agent-channel-remove` on busy channels
2. Or use `/agent-disable` temporarily

### "The bot gave a wrong answer"
1. React to the message (for visibility)
2. Reply with the correct answer (the bot will learn from this)
3. Optionally use `/teach` to explicitly teach the correct answer

### "I want to reset everything"
```
/agent-disable
/agent-channel-remove channel:#general
/agent-channel-remove channel:#support-français
```

Then start over with `/agent-enable` and add channels back one by one.

## Cost Impact

With the AI Support Agent enabled in 2-3 channels:
- **Previous cost**: ~$10-15/month (tickets only)
- **New cost**: ~$20-30/month (tickets + agent)
- **Savings**: Your time not answering repetitive questions

The bot is cost-efficient:
- Only calls Claude when it detects a question
- Rate-limited to prevent runaway costs
- Uses confidence scoring to avoid guessing

You can monitor API usage in your Anthropic dashboard.

## What Gets Better Over Time

The bot learns in two ways:

1. **Automatic learning**: Every time staff answers a question, the bot saves it as a Q&A pair during the next rebuild (every 6 hours).

2. **Manual teaching**: Use `/teach` to explicitly add answers.

After 1-2 months, the bot should know answers to:
- 80% of account/access questions
- 90% of tool-specific questions (credits, resets, logins)
- 70% of "how do I..." questions

It will never learn:
- Billing/refund policies (always escalated)
- User-specific info (always escalated)
- Partnership inquiries (always escalated)

## Questions?

Check the full README.md for technical details, or:
- Run `/agent-status` to see current state
- Check the `#ai-alerts` channel for low-confidence questions
- Use `/agent-disable` if you need to pause everything

The bot is designed to be **conservative** by default. It's better to send too many alerts than to give wrong answers.
