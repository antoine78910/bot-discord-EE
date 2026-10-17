const fs = require('fs');
const path = require('path');

/**
 * AI Support Agent - Enhanced knowledge base and confidence-based responses
 * 
 * This module extends the existing ticket bot with:
 * - Q&A extraction from message history
 * - Confidence-based responses in general channels
 * - Rate limiting and spam prevention
 * - Per-channel configuration
 */

// === Configuration ===
const CONFIDENCE_THRESHOLD = 0.7; // Only reply if confidence >= 70%
const RATE_LIMIT_MESSAGES_PER_HOUR = 10;
const RATE_LIMIT_MESSAGES_PER_CHANNEL_PER_HOUR = 3;
const MIN_MESSAGE_INTERVAL_MS = 60 * 1000; // 1 minute between replies
const STAFF_RESPONSE_LOOKBACK = 5; // Check last 5 messages for staff activity
const SENSITIVE_KEYWORDS = [
    'refund',
    'rembours',
    'billing',
    'facturation',
    'payment',
    'paiement',
    'ban',
    'banned',
    'banni',
    'legal',
    'lawsuit',
    'dispute',
    'litige',
    'partner',
    'partenaire',
    'scam',
    'fraud',
    'fraude',
    'steal',
    'vol',
];

// === State tracking ===
const enabledChannels = new Set();
const lastReplyTimestamps = new Map(); // channelId -> timestamp
const replyCountsGlobal = []; // Array of timestamps in last hour
const replyCountsPerChannel = new Map(); // channelId -> array of timestamps

// Staff alert configuration
let staffAlertChannelId = null;
let agentEnabled = true;

// === Knowledge base Q&A pairs ===
let qaKnowledgeBase = [];

/**
 * Extract Q&A pairs from message history
 * Looks for patterns where users ask questions and staff/Antoine answers
 */
async function extractQAPairsFromChannel(channel, client, ownerUserId, staffRoleId) {
    const pairs = [];
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        
        for (let i = 0; i < ordered.length - 1; i++) {
            const userMsg = ordered[i];
            
            // Skip if not a user question
            if (userMsg.author.bot) continue;
            if (!userMsg.content?.trim()) continue;
            
            // Check if message looks like a question
            const content = userMsg.content.trim();
            if (!isQuestion(content)) continue;
            
            // Look for staff/owner response in next few messages
            for (let j = i + 1; j < Math.min(i + 5, ordered.length); j++) {
                const staffMsg = ordered[j];
                
                // Check if this is a staff/owner response
                const isStaff = staffRoleId && staffMsg.member?.roles?.cache?.has(staffRoleId);
                const isOwner = ownerUserId && staffMsg.author?.id === ownerUserId;
                
                if ((isStaff || isOwner) && staffMsg.content?.trim()) {
                    pairs.push({
                        question: content.slice(0, 500),
                        answer: staffMsg.content.trim().slice(0, 1000),
                        channelName: channel.name,
                        timestamp: userMsg.createdTimestamp,
                        source: 'history_extraction',
                    });
                    break;
                }
            }
        }
    } catch (error) {
        console.warn(`[AI-AGENT] Failed to extract Q&A from #${channel.name}:`, error.message);
    }
    return pairs;
}

/**
 * Check if a message looks like a question
 */
function isQuestion(text) {
    const lower = text.toLowerCase();
    
    // Question marks
    if (text.includes('?')) return true;
    
    // Question words
    const questionWords = [
        'how', 'what', 'when', 'where', 'why', 'who', 'which',
        'comment', 'quoi', 'quand', 'où', 'pourquoi', 'qui', 'quel',
        'can i', 'puis-je', 'est-ce que', 'is it', 'do you', 'does',
        'help', 'aide', 'problem', 'problème', 'issue', 'error', 'erreur',
    ];
    
    return questionWords.some(word => lower.includes(word));
}

/**
 * Build enhanced knowledge base from Q&A pairs
 */
async function buildQAKnowledgeBase(guild, client, ownerUserId, staffRoleId) {
    console.log('[AI-AGENT] Building Q&A knowledge base from message history...');
    const startTime = Date.now();
    
    qaKnowledgeBase = [];
    
    try {
        const channels = await guild.channels.fetch();
        const textChannels = [...channels.values()].filter(
            c => c.isTextBased() && !c.name.toLowerCase().startsWith('ticket-')
        );
        
        for (const channel of textChannels) {
            try {
                // Check bot permissions
                const me = guild.members.me;
                if (!me) continue;
                
                const perms = channel.permissionsFor(me);
                if (!perms?.has('ViewChannel') || !perms?.has('ReadMessageHistory')) continue;
                
                const pairs = await extractQAPairsFromChannel(channel, client, ownerUserId, staffRoleId);
                qaKnowledgeBase.push(...pairs);
                
                if (pairs.length > 0) {
                    console.log(`[AI-AGENT] Extracted ${pairs.length} Q&A pairs from #${channel.name}`);
                }
            } catch (error) {
                console.warn(`[AI-AGENT] Skip channel #${channel.name}:`, error.message);
            }
        }
        
        // Sort by recency
        qaKnowledgeBase.sort((a, b) => b.timestamp - a.timestamp);
        
        const elapsed = Date.now() - startTime;
        console.log(`[AI-AGENT] Q&A knowledge base built: ${qaKnowledgeBase.length} pairs in ${elapsed}ms`);
    } catch (error) {
        console.error('[AI-AGENT] Failed to build Q&A knowledge base:', error);
    }
}

/**
 * Format Q&A knowledge base for system prompt
 */
function formatQAKnowledge() {
    if (qaKnowledgeBase.length === 0) {
        return '(No Q&A pairs extracted yet)';
    }
    
    // Take most recent 50 pairs to keep prompt size reasonable
    const recent = qaKnowledgeBase.slice(0, 50);
    
    return recent.map((qa, idx) => 
        `${idx + 1}. Q: ${qa.question}\n   A: ${qa.answer}\n   (from #${qa.channelName})`
    ).join('\n\n');
}

/**
 * Detect if message contains sensitive topics that should be escalated
 */
function containsSensitiveTopic(content) {
    const lower = content.toLowerCase();
    return SENSITIVE_KEYWORDS.some(keyword => lower.includes(keyword));
}

/**
 * Check if staff is actively responding in the channel
 */
async function isStaffActiveInChannel(channel, ownerUserId, staffRoleId) {
    try {
        const recent = await channel.messages.fetch({ limit: STAFF_RESPONSE_LOOKBACK });
        const messages = [...recent.values()];
        
        // Check if any recent message is from staff
        for (const msg of messages) {
            if (msg.author.bot) continue;
            
            const isOwner = ownerUserId && msg.author.id === ownerUserId;
            const isStaff = staffRoleId && msg.member?.roles?.cache?.has(staffRoleId);
            
            if (isOwner || isStaff) {
                // Staff was active in last few messages
                const messageAge = Date.now() - msg.createdTimestamp;
                if (messageAge < 5 * 60 * 1000) { // 5 minutes
                    return true;
                }
            }
        }
    } catch (error) {
        console.warn('[AI-AGENT] Failed to check staff activity:', error.message);
    }
    return false;
}

/**
 * Check rate limits
 */
function isRateLimited(channelId) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Clean old timestamps
    while (replyCountsGlobal.length > 0 && replyCountsGlobal[0] < oneHourAgo) {
        replyCountsGlobal.shift();
    }
    
    // Check global rate limit
    if (replyCountsGlobal.length >= RATE_LIMIT_MESSAGES_PER_HOUR) {
        return true;
    }
    
    // Check per-channel rate limit
    const channelCounts = replyCountsPerChannel.get(channelId) || [];
    const recentChannelReplies = channelCounts.filter(ts => ts > oneHourAgo);
    replyCountsPerChannel.set(channelId, recentChannelReplies);
    
    if (recentChannelReplies.length >= RATE_LIMIT_MESSAGES_PER_CHANNEL_PER_HOUR) {
        return true;
    }
    
    // Check minimum interval
    const lastReply = lastReplyTimestamps.get(channelId) || 0;
    if (now - lastReply < MIN_MESSAGE_INTERVAL_MS) {
        return true;
    }
    
    return false;
}

/**
 * Record a reply for rate limiting
 */
function recordReply(channelId) {
    const now = Date.now();
    replyCountsGlobal.push(now);
    
    const channelCounts = replyCountsPerChannel.get(channelId) || [];
    channelCounts.push(now);
    replyCountsPerChannel.set(channelId, channelCounts);
    
    lastReplyTimestamps.set(channelId, now);
}

/**
 * Ask AI for confidence score on answering a question
 * Supports both OpenAI and Anthropic
 */
async function getAnswerWithConfidence(message, systemPrompt, aiConfig) {
    try {
        const content = message.content.trim();
        const { anthropicClient, openaiClient, provider, openaiModel, claudeModel } = aiConfig;
        
        const prompt = `${systemPrompt}

## CONFIDENCE SCORING

After providing your answer, you MUST rate your confidence on a scale of 0.0 to 1.0:
- 1.0 = Completely certain, the answer is directly from FAQ/knowledge
- 0.7-0.9 = High confidence, well-supported by available information
- 0.4-0.6 = Moderate confidence, partial information available
- 0.0-0.3 = Low confidence, mostly guessing or unclear

Format your response EXACTLY as:
<answer>Your answer here</answer>
<confidence>0.X</confidence>

User question: ${content}`;

        let text;
        
        if (provider === 'openai' && openaiClient) {
            const response = await openaiClient.chat.completions.create({
                model: openaiModel,
                max_tokens: 500,
                temperature: 0.7,
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: content }
                ],
            });
            text = response.choices[0]?.message?.content?.trim() || '';
        } else if (anthropicClient) {
            const response = await anthropicClient.messages.create({
                model: claudeModel,
                max_tokens: 500,
                messages: [{
                    role: 'user',
                    content: prompt,
                }],
            });
            text = response.content.map(block => block?.text || '').join('').trim();
        } else {
            return null;
        }
        
        // Parse response
        const answerMatch = text.match(/<answer>([\s\S]*?)<\/answer>/);
        const confidenceMatch = text.match(/<confidence>([\d.]+)<\/confidence>/);
        
        if (!answerMatch || !confidenceMatch) {
            console.warn('[AI-AGENT] Failed to parse confidence response');
            return null;
        }
        
        const answer = answerMatch[1].trim();
        const confidence = parseFloat(confidenceMatch[1]);
        
        return { answer, confidence };
    } catch (error) {
        console.error('[AI-AGENT] Failed to get answer with confidence:', error);
        return null;
    }
}

/**
 * Send staff alert for low-confidence question
 */
async function sendStaffAlert(channel, message, confidence, client) {
    if (!staffAlertChannelId) return;
    
    try {
        const alertChannel = await client.channels.fetch(staffAlertChannelId);
        if (!alertChannel?.isTextBased()) return;
        
        const preview = message.content.slice(0, 200);
        const jumpUrl = message.url;
        
        await alertChannel.send({
            content: `⚠️ **Low-confidence question in ${channel}**\n` +
                     `Confidence: ${(confidence * 100).toFixed(0)}%\n` +
                     `Question: ${preview}${message.content.length > 200 ? '...' : ''}\n` +
                     `${jumpUrl}`,
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        console.warn('[AI-AGENT] Failed to send staff alert:', error.message);
    }
}

/**
 * Main handler for general chat monitoring
 */
async function handleGeneralChatMessage(message, config) {
    if (!agentEnabled) return;
    if (!message?.channel || message.author?.bot) return;
    
    const { client, anthropicClient, model, ownerUserId, staffRoleId } = config;
    
    // Check if channel is enabled
    if (!enabledChannels.has(message.channel.id)) return;
    
    // Don't respond to staff
    const isOwner = ownerUserId && message.author.id === ownerUserId;
    const isStaff = staffRoleId && message.member?.roles?.cache?.has(staffRoleId);
    if (isOwner || isStaff) return;
    
    // Check if message is a question
    if (!isQuestion(message.content)) return;
    
    // Check if contains sensitive topics
    if (containsSensitiveTopic(message.content)) {
        await sendStaffAlert(message.channel, message, 0, client);
        return;
    }
    
    // Check if staff is already active
    if (await isStaffActiveInChannel(message.channel, ownerUserId, staffRoleId)) {
        console.log(`[AI-AGENT] Staff active in #${message.channel.name}, skipping`);
        return;
    }
    
    // Check rate limits
    if (isRateLimited(message.channel.id)) {
        console.log(`[AI-AGENT] Rate limited in #${message.channel.name}`);
        return;
    }
    
    // Get answer with confidence
    const systemPrompt = buildSystemPrompt(config);
    const aiConfig = {
        anthropicClient: config.anthropicClient,
        openaiClient: config.openaiClient,
        provider: config.provider,
        openaiModel: config.openaiModel,
        claudeModel: config.model,
    };
    const result = await getAnswerWithConfidence(message, systemPrompt, aiConfig);
    
    if (!result) return;
    
    const { answer, confidence } = result;
    
    console.log(`[AI-AGENT] Answer confidence: ${(confidence * 100).toFixed(0)}% for question in #${message.channel.name}`);
    
    // If confidence is too low, alert staff
    if (confidence < CONFIDENCE_THRESHOLD) {
        await sendStaffAlert(message.channel, message, confidence, client);
        return;
    }
    
    // Send the answer
    try {
        await message.reply({
            content: answer.slice(0, 1900),
            allowedMentions: { parse: [] },
        });
        
        recordReply(message.channel.id);
        console.log(`[AI-AGENT] Replied in #${message.channel.name} with ${(confidence * 100).toFixed(0)}% confidence`);
    } catch (error) {
        console.error('[AI-AGENT] Failed to send reply:', error);
    }
}

/**
 * Build system prompt with Q&A knowledge
 */
function buildSystemPrompt(config) {
    const { faqText } = config;
    
    return `You are a helpful support assistant for Ecom Efficiency Discord server.

## STYLE
- Be concise and friendly
- Match the user's language (French → French, English → English, etc.)
- Answer in 1-3 sentences
- No emojis unless the user uses them

## KNOWLEDGE SOURCES
Use the FAQ and Q&A pairs below to answer questions. Never invent information.

## FAQ
${faqText || '(No FAQ available)'}

## EXTRACTED Q&A PAIRS
${formatQAKnowledge()}

## SENSITIVE TOPICS
Never answer questions about refunds, billing disputes, bans, partnerships, or legal matters. These are handled separately.`;
}

/**
 * Enable AI agent in a channel
 */
function enableChannel(channelId) {
    enabledChannels.add(channelId);
}

/**
 * Disable AI agent in a channel
 */
function disableChannel(channelId) {
    enabledChannels.delete(channelId);
}

/**
 * Check if channel is enabled
 */
function isChannelEnabled(channelId) {
    return enabledChannels.has(channelId);
}

/**
 * Set staff alert channel
 */
function setStaffAlertChannel(channelId) {
    staffAlertChannelId = channelId;
}

/**
 * Get staff alert channel
 */
function getStaffAlertChannel() {
    return staffAlertChannelId;
}

/**
 * Enable/disable the entire agent
 */
function setAgentEnabled(enabled) {
    agentEnabled = enabled;
}

/**
 * Check if agent is enabled
 */
function isAgentEnabled() {
    return agentEnabled;
}

/**
 * Get enabled channels list
 */
function getEnabledChannels() {
    return Array.from(enabledChannels);
}

/**
 * Get stats
 */
function getStats() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const repliesLastHour = replyCountsGlobal.filter(ts => ts > oneHourAgo).length;
    
    return {
        enabled: agentEnabled,
        enabledChannels: enabledChannels.size,
        qaKnowledgeBase: qaKnowledgeBase.length,
        repliesLastHour,
        staffAlertChannel: staffAlertChannelId,
    };
}

module.exports = {
    buildQAKnowledgeBase,
    handleGeneralChatMessage,
    enableChannel,
    disableChannel,
    isChannelEnabled,
    setStaffAlertChannel,
    getStaffAlertChannel,
    setAgentEnabled,
    isAgentEnabled,
    getEnabledChannels,
    getStats,
    formatQAKnowledge,
};
