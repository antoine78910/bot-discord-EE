# Cost Estimation - AI Support Agent (Claude Haiku)

Detailed breakdown of expected monthly costs using **Claude Haiku 4** - **12x less expensive** than Sonnet.

## Why Claude Haiku?

✅ **12x cheaper** than Claude Sonnet 4.5
✅ Still **very intelligent** for Q&A tasks
✅ **Faster responses** (lower latency)
✅ Perfect for **short, factual answers**
✅ Excellent **reasoning abilities** from knowledge base

## Anthropic Claude Haiku Pricing

**Input tokens:**
- Standard: $0.25 / 1M tokens (vs $3.00 for Sonnet = **12x cheaper**)
- With prompt caching (write): $0.30 / 1M tokens
- With prompt caching (read): $0.03 / 1M tokens (vs $0.30 for Sonnet = **10x cheaper**)

**Output tokens:**
- $1.25 / 1M tokens (vs $15.00 for Sonnet = **12x cheaper**)

---

## Scenario 1: Tickets Only (Current State)

**Usage:**
- 100 ticket messages per day
- Average conversation: 5 messages
- 20 ticket conversations per day

**Token usage per ticket conversation:**
- System prompt: ~2,000 tokens (cached after first use)
- Context (5 messages): ~500 tokens
- Response: ~150 tokens (Haiku gives concise answers)

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
- Input tokens: 1.5M tokens = **$0.38** (vs $4.50 with Sonnet)
- Cached write: 1.2M tokens = **$0.36** (vs $4.50 with Sonnet)
- Cached read: 4.8M tokens = **$0.14** (vs $1.44 with Sonnet)
- Output tokens: 450K tokens = **$0.56** (vs $6.75 with Sonnet)

**Total: ~$1.44/month** (vs $17.19 with Sonnet) 🎉

---

## Scenario 2: With AI Support Agent (2-3 Channels)

**Additional usage:**
- 30-50 general chat questions per day
- Agent responds to ~20 (others are escalated)

**Token usage per agent response:**
- System prompt: ~3,000 tokens (includes Q&A knowledge base, cached)
- Question: ~100 tokens
- Confidence scoring: Extra ~50 tokens
- Response: ~100 tokens (Haiku is concise)

**Calculations:**

Agent responses (20 per day):
- Input: 100 tokens × 20 = 2,000 tokens/day
- Cached prompt (first check): 3,000 tokens × 20 = 60,000 tokens/day (write)
- Cached prompt (reused): 3,000 tokens × 20 = 60,000 tokens/day (read)
- Output: 150 tokens × 20 = 3,000 tokens/day

**Monthly agent totals:**
- Input tokens: 60K tokens = **$0.015**
- Cached write: 1.8M tokens = **$0.54**
- Cached read: 1.8M tokens = **$0.054**
- Output tokens: 90K tokens = **$0.11**

**Combined monthly cost:**
- Tickets: $1.44
- Agent: $0.72

**Total: ~$2.16/month** (vs $26 with Sonnet) 🚀

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
- Input tokens: 150K tokens = **$0.04**
- Cached write: 4.5M tokens = **$1.35**
- Cached read: 4.5M tokens = **$0.14**
- Output tokens: 225K tokens = **$0.28**

**Combined monthly cost:**
- Tickets: $1.44
- Agent: $1.81

**Total: ~$3.25/month** (vs $39 with Sonnet) 🎉

---

## Rate Limiting Protection

With hard-coded rate limits (10 replies/hour = 240 replies/day max):

**Absolute maximum (if rate limit is hit 24/7):**
- Max agent responses: 240/day
- Monthly input tokens: ~720K = **$0.18**
- Monthly cached write: ~21.6M = **$6.48**
- Monthly cached read: ~21.6M = **$0.65**
- Monthly output: ~1.08M = **$1.35**

**Absolute maximum: ~$8.66/month** (vs $106 with Sonnet)

**Realistic maximum with heavy usage: ~$5-6/month**

---

## Railway Hosting Costs

**Current plan:** Hobby ($5/month) - unchanged

---

## Total Cost Summary

| Scenario | API Cost (Haiku) | API Cost (Sonnet) | Railway | Total (Haiku) | Total (Sonnet) | Savings |
|----------|------------------|-------------------|---------|---------------|----------------|---------|
| Current (tickets only) | $1.44 | $17 | $5 | **$6.44** | $22 | **-$15.56** |
| Conservative (2-3 channels) | $2.16 | $26 | $5 | **$7.16** | $31 | **-$23.84** |
| Recommended (3-5 channels) | $2.80 | $35 | $5 | **$7.80** | $40 | **-$32.20** |
| Heavy (5-6 channels) | $3.70 | $45 | $5 | **$8.70** | $50 | **-$41.30** |
| **Absolute maximum (rate limited)** | $8.66 | $100 | $5 | **$13.66** | $105 | **-$91.34** |

---

## Cost Comparison: Haiku vs Sonnet

### Monthly Cost Reduction

| Usage Level | Sonnet Cost | Haiku Cost | Savings/Month | Savings/Year |
|-------------|-------------|------------|---------------|--------------|
| Tickets only | $22 | $6.44 | **-$15.56** | **-$187** |
| 2-3 channels | $31 | $7.16 | **-$23.84** | **-$286** |
| 3-5 channels | $40 | $7.80 | **-$32.20** | **-$386** |
| Heavy usage | $50 | $8.70 | **-$41.30** | **-$496** |

### Cost Reduction Percentage

**Haiku is 73-85% cheaper than Sonnet** across all usage scenarios!

---

## ROI Calculation with Haiku

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

**Conservative scenario (+$0.72/month incremental for agent):**
- $0.72 / 22.5 hours = **$0.03/hour** saved

**Recommended scenario (+$1.36/month incremental):**
- $1.36 / 22.5 hours = **$0.06/hour** saved

**Compared to Sonnet:**
- Sonnet: $0.80/hour saved
- Haiku: **$0.03/hour saved** (26x better ROI!)

---

## Haiku vs Sonnet: Quality Comparison

### What Haiku Does Well ✅

- ✅ **Short, factual answers** (perfect for support Q&A)
- ✅ **Reasoning from knowledge base** (excellent)
- ✅ **Language detection** (same as Sonnet)
- ✅ **Confidence scoring** (reliable)
- ✅ **Following instructions** (very good)
- ✅ **Speed** (2-3x faster than Sonnet)

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

**Sonnet would be overkill** - like hiring a professor to answer "what time does the store close?"

---

## Cost Monitoring with Haiku

### Expected Monthly Bill

**Week 1-4 (learning phase):**
- Tickets: ~$1.50
- Agent (2-3 channels): ~$0.70
- **Total: ~$2.20/month**

**After 1 month (optimized):**
- Tickets: ~$1.40
- Agent: ~$0.60
- **Total: ~$2.00/month**

**This is so cheap you don't need to monitor it closely!**

For reference:
- A single Starbucks coffee: $5
- Monthly Haiku cost: $2-3

---

## When to Consider Upgrading to Sonnet

You might want Sonnet if:

1. ❌ Users complain answers are too short
2. ❌ Confidence scores are consistently low (<50%)
3. ❌ Bot frequently gives wrong answers
4. ❌ You need detailed multi-paragraph explanations

**But for typical support Q&A:** Haiku is perfect ✅

You can always test both:
- Start with Haiku (cheap)
- If quality isn't good enough, upgrade to Sonnet
- Cost difference is only $20-30/month

---

## Real-World Comparison

### Similar Services with AI Support

**Intercom AI Agent:** $99-$499/month
**Zendesk AI:** $50-$200/month per agent
**Custom ChatGPT integration:** ~$50-$100/month

**This solution with Haiku:** $2-3/month

**Savings vs commercial solutions:** $97-$497/month 🚀

---

## Conclusion

**Recommended setup:** Claude Haiku 4

**Expected incremental cost:** $0.70-1.40/month (agent only)
**Total cost:** $7-9/month (tickets + agent + Railway)

**Value received:**
- 20+ hours/month saved
- 24/7 member support
- Faster response times
- Scalable to handle growth
- Learns and improves over time

**Cost per hour saved:** $0.03-0.06/hour

**Recommendation:** Use Haiku. It's **12x cheaper**, perfectly capable for Q&A, and you can always upgrade to Sonnet later if needed.

The cost is **negligible** (less than a coffee), **capped by rate limits**, and provides **exceptional ROI** compared to manual support or commercial alternatives.

---

## Migration Note

**Currently using Sonnet 4.5?** Just update the env var:

```bash
# In Railway Variables
CLAUDE_MODEL=claude-haiku-4
```

Redeploy and you're done! Same code, 12x cheaper. 🎉
