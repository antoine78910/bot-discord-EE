# Cost Estimation - AI Support Agent

Detailed breakdown of expected monthly costs for the Ecom Efficiency Discord bot with the new AI Support Agent.

## Anthropic Claude API Costs

### Pricing (Claude Sonnet 4.5)

**Input tokens:**
- Standard: $3.00 / 1M tokens
- With prompt caching (write): $3.75 / 1M tokens
- With prompt caching (read): $0.30 / 1M tokens

**Output tokens:**
- $15.00 / 1M tokens

### Prompt Caching Impact

The bot uses prompt caching (already configured) which dramatically reduces costs:
- System prompt (FAQ + knowledge base) is cached
- Each ticket/question reuses the cached prompt
- **~90% reduction in input token costs**

---

## Scenario 1: Tickets Only (Current State)

**Usage:**
- 100 ticket messages per day
- Average conversation: 5 messages
- 20 ticket conversations per day

**Token usage per ticket conversation:**
- System prompt: ~2,000 tokens (cached after first use)
- Context (5 messages): ~500 tokens
- Response: ~150 tokens

**Calculations:**

First message in each conversation:
- Input: 2,500 tokens × 20 = 50,000 tokens/day
- Cached write: 2,000 tokens × 20 = 40,000 tokens/day
- Output: 150 tokens × 20 = 3,000 tokens/day

Subsequent messages (4 per conversation × 20):
- Input (cached): 500 tokens × 80 = 40,000 tokens/day
- Cached read: 2,000 tokens × 80 = 160,000 tokens/day
- Output: 150 tokens × 80 = 12,000 tokens/day

**Monthly totals:**
- Input tokens: 1.5M tokens = $4.50
- Cached write: 1.2M tokens = $4.50
- Cached read: 4.8M tokens = $1.44
- Output tokens: 450K tokens = $6.75

**Total: ~$17-18/month**

---

## Scenario 2: With AI Support Agent (2-3 Channels)

**Additional usage:**
- 30-50 general chat questions per day
- Agent responds to ~20 (others are escalated)

**Token usage per agent response:**
- System prompt: ~3,000 tokens (includes Q&A knowledge base, cached)
- Question: ~100 tokens
- Confidence scoring: Extra ~50 tokens
- Response: ~100 tokens

**Calculations:**

Agent responses (20 per day):
- Input: 100 tokens × 20 = 2,000 tokens/day
- Cached prompt (first check): 3,000 tokens × 20 = 60,000 tokens/day (write)
- Cached prompt (reused): 3,000 tokens × 20 = 60,000 tokens/day (read)
- Output: 150 tokens × 20 = 3,000 tokens/day

**Monthly agent totals:**
- Input tokens: 60K tokens = $0.18
- Cached write: 1.8M tokens = $6.75
- Cached read: 1.8M tokens = $0.54
- Output tokens: 90K tokens = $1.35

**Combined monthly cost:**
- Tickets: $17.19
- Agent: $8.82

**Total: ~$26/month**

---

## Scenario 3: Heavy Usage (4-6 Channels)

**Additional usage:**
- 80-100 general chat questions per day
- Agent responds to ~50

**Agent responses (50 per day):**
- Input: 100 tokens × 50 = 5,000 tokens/day
- Cached write: 3,000 tokens × 50 = 150,000 tokens/day
- Cached read: 3,000 tokens × 50 = 150,000 tokens/day
- Output: 150 tokens × 50 = 7,500 tokens/day

**Monthly agent totals:**
- Input tokens: 150K tokens = $0.45
- Cached write: 4.5M tokens = $16.88
- Cached read: 4.5M tokens = $1.35
- Output tokens: 225K tokens = $3.38

**Combined monthly cost:**
- Tickets: $17.19
- Agent: $22.06

**Total: ~$39/month**

---

## Rate Limiting Protection

The agent has hard-coded rate limits that cap maximum usage:

**Hard limits:**
- 10 replies per hour globally = **240 replies/day max**
- 3 replies per hour per channel = **72 replies/day per channel max**

**Cost ceiling with rate limits:**
- Max agent responses: 240/day
- Monthly input tokens: ~720K = $2.16
- Monthly cached write: ~21.6M = $81
- Monthly cached read: ~21.6M = $6.48
- Monthly output: ~1.08M = $16.20

**Absolute maximum (if rate limit is hit 24/7): ~$106/month**

However, this is **extremely unlikely** because:
1. Rate limits are designed to prevent this
2. Bot only responds to questions (not every message)
3. Confidence threshold filters out 30-40% of questions
4. Staff presence silences the bot

**Realistic maximum with heavy usage: ~$50-60/month**

---

## Railway Hosting Costs

**Current plan:** Hobby ($5/month)

**Resources used:**
- ~100MB RAM (bot is lightweight)
- Minimal CPU (event-driven, mostly idle)
- <1GB disk (with volume: logs + history)

**Conclusion:** $5/month unchanged

---

## Total Cost Summary

| Scenario | API Cost | Railway | Total | vs Current |
|----------|----------|---------|-------|------------|
| Current (tickets only) | $17 | $5 | $22 | baseline |
| Conservative (2-3 channels) | $26 | $5 | $31 | +$9 |
| Recommended (3-5 channels) | $35 | $5 | $40 | +$18 |
| Heavy (5-6 channels) | $45 | $5 | $50 | +$28 |
| **Absolute maximum (rate limited)** | $100 | $5 | $105 | +$83 |

---

## Cost Optimization Tips

### 1. Start Conservative
Enable agent in 1-2 channels initially. Monitor costs for 1 week before expanding.

### 2. Monitor Anthropic Dashboard
Check usage daily for the first week at: https://console.anthropic.com/

### 3. Adjust Rate Limits
If costs are higher than expected, reduce limits in `aiSupportAgent.js`:

```javascript
const RATE_LIMIT_MESSAGES_PER_HOUR = 10; // reduce to 5
const RATE_LIMIT_MESSAGES_PER_CHANNEL_PER_HOUR = 3; // reduce to 2
```

### 4. Increase Confidence Threshold
If too many responses, raise the bar:

```javascript
const CONFIDENCE_THRESHOLD = 0.7; // increase to 0.8
```

This reduces replies but improves quality.

### 5. Remove Low-Value Channels
Check `/agent-status` weekly. Remove channels that:
- Generate many alerts (low success rate)
- Have high message volume but few questions
- Overlap with other monitored channels

---

## ROI Calculation

### Time Saved

**Assumptions:**
- Agent handles 60% of questions after 1 month
- Each question takes 2-3 minutes to answer manually
- 30 questions/day in monitored channels (conservative)

**Calculation:**
- Questions answered by bot: 18/day
- Time per question: 2.5 minutes
- Time saved per day: 45 minutes
- Time saved per month: **22.5 hours**

### Cost Per Hour Saved

**Conservative scenario (+$9/month):**
- $9 / 22.5 hours = **$0.40/hour** saved

**Recommended scenario (+$18/month):**
- $18 / 22.5 hours = **$0.80/hour** saved

Even if we **double** the cost estimate to account for variability:
- $36 / 22.5 hours = **$1.60/hour** saved

**Conclusion:** Extremely cost-effective, especially considering:
1. Antoine's time has value (consulting/development rate)
2. Faster response times improve member satisfaction
3. 24/7 availability (bot works while Antoine sleeps)
4. Scales infinitely (bot can handle 10× volume with same cost)

---

## Real-World Comparison

### Similar Services

**Intercom AI Agent:** $99-$499/month
**Zendesk AI:** $50-$200/month per agent
**Custom ChatGPT integration:** ~$50-$100/month

**This solution:** $9-$18/month incremental cost

**Savings vs commercial solutions:** $80-$480/month

---

## Cost Monitoring Checklist

### Week 1
- [ ] Check Anthropic dashboard daily
- [ ] Record actual usage vs estimates
- [ ] Monitor `/agent-status` for reply counts
- [ ] Verify rate limits are working

### Week 2-4
- [ ] Compare actual costs to estimates
- [ ] Identify highest-cost channels
- [ ] Optimize if costs exceed $40/month

### Monthly
- [ ] Review total Anthropic spend
- [ ] Calculate cost per question answered
- [ ] Adjust channels/settings if needed

---

## Expected Cost Trajectory

**Month 1:** $25-35 (learning phase, some wasted responses)
**Month 2:** $20-30 (improved efficiency, better confidence scoring)
**Month 3+:** $20-25 (stable, optimized configuration)

As the bot learns:
1. Confidence scores improve → fewer escalations
2. Fewer API calls wasted → lower cost
3. Better answers → fewer follow-up questions

**The bot gets cheaper over time while handling more questions.**

---

## Conclusion

**Expected incremental cost:** $10-20/month

**Value received:**
- 20+ hours/month saved
- 24/7 member support
- Faster response times
- Scalable to handle growth
- Learns and improves over time

**Cost per hour saved:** $0.50-$1.00/hour

**Recommendation:** Deploy in 2-3 channels, monitor for 2 weeks, expand if successful.

The cost is **predictable**, **capped by rate limits**, and provides **exceptional ROI** compared to manual support or commercial alternatives.
