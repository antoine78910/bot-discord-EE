# Cost Estimation - AI Support Agent (Claude 3.5 Haiku)

Detailed breakdown of expected monthly costs using **Claude 3.5 Haiku** - cost-efficient model perfect for Q&A.

## Model Used

**Model ID:** `claude-3-5-haiku-20241022`
**Model Name:** Claude 3.5 Haiku

## Why Claude 3.5 Haiku?

✅ **~4x cheaper** than Claude 3.5 Sonnet
✅ **Very intelligent** for Q&A and reasoning tasks
✅ **Fast responses** (optimized for speed)
✅ Perfect for **short, factual answers**
✅ Excellent **reasoning abilities** from knowledge base

## Anthropic Claude 3.5 Haiku Pricing

**Input tokens:**
- Standard: $0.80 / 1M tokens
- With prompt caching (write): $1.00 / 1M tokens
- With prompt caching (read): $0.08 / 1M tokens

**Output tokens:**
- $4.00 / 1M tokens

**Comparison to Claude 3.5 Sonnet:**
- Input: $0.80 vs $3.00 (3.75x cheaper)
- Output: $4.00 vs $15.00 (3.75x cheaper)
- Cached read: $0.08 vs $0.30 (3.75x cheaper)

---

## Scenario 1: Tickets Only (Current State)

**Usage:**
- 100 ticket messages per day
- Average conversation: 5 messages
- 20 ticket conversations per day

**Token usage per ticket conversation:**
- System prompt: ~2,000 tokens (cached after first use)
- Context (5 messages): ~500 tokens
- Response: ~150 tokens (concise answers)

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
- Input tokens: 1.5M tokens = **$1.20**
- Cached write: 1.2M tokens = **$1.20**
- Cached read: 4.8M tokens = **$0.38**
- Output tokens: 450K tokens = **$1.80**

**Total: ~$4.58/month**

---

## Scenario 2: With AI Support Agent (2-3 Channels)

**Additional usage:**
- 30-50 general chat questions per day
- Agent responds to ~20 (others are escalated)

**Token usage per agent response:**
- System prompt: ~3,000 tokens (includes Q&A knowledge base, cached)
- Question: ~100 tokens
- Confidence scoring: Extra ~50 tokens
- Response: ~100 tokens (concise)

**Calculations:**

Agent responses (20 per day):
- Input: 100 tokens × 20 = 2,000 tokens/day
- Cached prompt (first check): 3,000 tokens × 20 = 60,000 tokens/day (write)
- Cached prompt (reused): 3,000 tokens × 20 = 60,000 tokens/day (read)
- Output: 150 tokens × 20 = 3,000 tokens/day

**Monthly agent totals:**
- Input tokens: 60K tokens = **$0.05**
- Cached write: 1.8M tokens = **$1.80**
- Cached read: 1.8M tokens = **$0.14**
- Output tokens: 90K tokens = **$0.36**

**Combined monthly cost:**
- Tickets: $4.58
- Agent: $2.35

**Total: ~$6.93/month**

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
- Input tokens: 150K tokens = **$0.12**
- Cached write: 4.5M tokens = **$4.50**
- Cached read: 4.5M tokens = **$0.36**
- Output tokens: 225K tokens = **$0.90**

**Combined monthly cost:**
- Tickets: $4.58
- Agent: $5.88

**Total: ~$10.46/month**

---

## Rate Limiting Protection

With hard-coded rate limits (10 replies/hour = 240 replies/day max):

**Absolute maximum (if rate limit is hit 24/7):**
- Max agent responses: 240/day
- Monthly input tokens: ~720K = **$0.58**
- Monthly cached write: ~21.6M = **$21.60**
- Monthly cached read: ~21.6M = **$1.73**
- Monthly output: ~1.08M = **$4.32**

**Agent maximum: ~$28.23/month**
**Total with tickets: ~$33/month**

**Realistic maximum with heavy usage: ~$12-15/month**

---

## Railway Hosting Costs

**Current plan:** Hobby ($5/month) - unchanged

---

## Total Cost Summary

| Scenario | API Cost (3.5 Haiku) | Railway | Total | 
|----------|----------------------|---------|-------|
| Current (tickets only) | $4.58 | $5 | **$9.58** |
| Conservative (2-3 channels) | $6.93 | $5 | **$11.93** |
| Recommended (3-5 channels) | $8.50 | $5 | **$13.50** |
| Heavy (5-6 channels) | $10.46 | $5 | **$15.46** |
| **Absolute maximum (rate limited)** | $33 | $5 | **$38** |

---

## Cost Comparison: Claude 3.5 Haiku vs Claude 3.5 Sonnet

### Monthly Cost Comparison

| Usage Level | Sonnet Cost | Haiku Cost | Savings/Month | Savings/Year |
|-------------|-------------|------------|---------------|--------------|
| Tickets only | $22 | $9.58 | **-$12.42** | **-$149** |
| 2-3 channels | $31 | $11.93 | **-$19.07** | **-$229** |
| 3-5 channels | $40 | $13.50 | **-$26.50** | **-$318** |
| Heavy usage | $50 | $15.46 | **-$34.54** | **-$414** |

### Cost Reduction Percentage

**Haiku is 60-70% cheaper than Sonnet** across all usage scenarios.

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

**Conservative scenario (+$2.35/month incremental for agent):**
- $2.35 / 22.5 hours = **$0.10/hour** saved

**Recommended scenario (+$3.92/month incremental):**
- $3.92 / 22.5 hours = **$0.17/hour** saved

**Heavy usage scenario (+$5.88/month incremental):**
- $5.88 / 22.5 hours = **$0.26/hour** saved

---

## Claude 3.5 Haiku vs 3.5 Sonnet: Quality Comparison

### What Haiku Does Well ✅

- ✅ **Short, factual answers** (perfect for support Q&A)
- ✅ **Reasoning from knowledge base** (excellent)
- ✅ **Language detection** (same as Sonnet)
- ✅ **Confidence scoring** (reliable)
- ✅ **Following instructions** (very good)
- ✅ **Speed** (optimized for low latency)

### Where Sonnet Is Better (but not needed here)

- ❌ Very long, detailed explanations
- ❌ Complex creative writing
- ❌ Deep code analysis
- ❌ Nuanced philosophical discussions

### For This Use Case (Support Q&A)

**Haiku is perfect because:**
1. Answers should be **short and concise** (1-3 sentences)
2. Questions are **factual** (tool access, resets, logins)
3. Knowledge base is **structured** (FAQ, Q&A pairs)
4. Speed matters (users expect quick replies)

**Sonnet would be overkill** and 3.75x more expensive for the same task.

---

## Expected Monthly Bill

**Week 1-4 (learning phase):**
- Tickets: ~$4.60
- Agent (2-3 channels): ~$2.40
- **Total: ~$12/month**

**After 1 month (optimized):**
- Tickets: ~$4.60
- Agent: ~$2.20
- **Total: ~$11.80/month**

**This is very affordable** - roughly the cost of 2 Starbucks coffees per month!

---

## Real-World Comparison

### Commercial AI Support Solutions

**Intercom AI Agent:** $99-$499/month
**Zendesk AI:** $50-$200/month per agent
**Custom ChatGPT integration:** ~$50-$100/month

**This solution with Claude 3.5 Haiku:** $12-15/month

**Savings vs commercial solutions:** $85-$484/month 🚀

---

## When to Consider Upgrading to Sonnet

You might want Sonnet if:

1. ❌ Users complain answers are too short
2. ❌ Confidence scores are consistently low (<50%)
3. ❌ Bot frequently gives wrong answers
4. ❌ You need detailed multi-paragraph explanations

**But for typical support Q&A:** Haiku is the right choice ✅

You can always test both:
- Start with Haiku (cost-efficient)
- If quality isn't good enough, upgrade to Sonnet
- Cost difference is ~$20-30/month

---

## Conclusion

**Recommended setup:** Claude 3.5 Haiku (`claude-3-5-haiku-20241022`)

**Expected incremental cost:** $2-6/month (agent only)
**Total cost:** $10-16/month (tickets + agent + Railway)

**Value received:**
- 20+ hours/month saved
- 24/7 member support
- Faster response times
- Scalable to handle growth
- Learns and improves over time

**Cost per hour saved:** $0.10-0.26/hour

**Recommendation:** Use Claude 3.5 Haiku. It's **3.75x cheaper than Sonnet**, perfectly capable for Q&A, and you can always upgrade to Sonnet later if needed.

The cost is **very affordable** (~$12-15/month), **capped by rate limits**, and provides **exceptional ROI** compared to manual support or commercial alternatives.

---

## Migration Note

**Setting the model:**

```bash
# In Railway Variables
CLAUDE_MODEL=claude-3-5-haiku-20241022
```

Or leave it empty - this is now the default in the code.

Redeploy and you're done! ✅
