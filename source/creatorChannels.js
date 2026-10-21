/**
 * Creator program channels (port of the YouRy bot's channel templates, adapted to Ecom Efficiency).
 * On startup each channel is found by name (or created next to #payout-submission) and its bot
 * messages are edited in place, so restarts never duplicate them.
 *
 * Copy source: Notion "Ecom Efficiency Account Setup & Warm-Up Guide".
 *
 * Env:
 *   CREATOR_CHANNEL_IDS        optional JSON {"start_here":"<id>", ...} to pin channels by id
 *   CREATOR_REGISTRATION_LOG_CHANNEL_ID   where registrations are posted (default: info channel)
 *   CREATOR_PAY_RATE / CREATOR_MIN_VIEWS / CREATOR_MIN_T1   payout terms shown in #start-here and #payouts
 */
const fs = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { sameMessage } = require('./discordSync');

const COLOR = 0x8b5cf6;
const BRAND = 'ECOM EFFICIENCY CREATORS';
const TOOLS = 'https://app.ecomefficiency.com/tools';
const ZORCHA = 'https://zorcha.com/';
const DM_SETUP_VIDEO = 'https://player.mediadelivery.net/play/776484/e2aa021a-927d-4727-abb0-dc95b4935b04';
const CREATOR_ROLE_ID = process.env.CREATOR_ROLE_ID || '1560108191142903868';
const ROLE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const PROFILE_PICTURES = 'https://drive.google.com/drive/folders/1WmSu-KKf1oPrnhrj3AKlt4Ai-RksM8XZ?usp=sharing';
const DM_LINK = 'https://docs.google.com/document/d/1h4iUz5icf6Vp1w96mH3bAW7eRBifaOQfahFfwyCMOiU/edit?usp=drive_link';
const REGISTRATION_LOG_CHANNEL_ID =
    process.env.CREATOR_REGISTRATION_LOG_CHANNEL_ID || process.env.CONTENT_INFO_CHANNEL_ID || '1556165339413352518';
const REVIEWER_ID = process.env.CONTENT_REVIEWER_ID || process.env.OWNER_USER_ID || '';
const PAY_RATE = process.env.CREATOR_PAY_RATE || '$500 per 500k views';
const MIN_VIEWS = process.env.CREATOR_MIN_VIEWS || '1k views';
const MIN_T1 = process.env.CREATOR_MIN_T1 || '20%';
const PINNED_IDS = (() => {
    const defaults = { referral: '1556165435689402398' };
    try {
        return { ...defaults, ...JSON.parse(process.env.CREATOR_CHANNEL_IDS || '{}') };
    } catch {
        return defaults;
    }
})();

const IDS = {
    register: 'ee_creator_register',
    modal: 'ee_creator_register_modal',
    approve: 'ee_creator_approve',
    reject: 'ee_creator_reject',
};
const USERNAME_COMMAND = 'username';
// /data is the Railway volume; the container filesystem is wiped on every deploy.
const STORE_PATH =
    process.env.CREATOR_STORE_PATH ||
    (fs.existsSync('/data') ? '/data/creator-registrations.json' : path.join(__dirname, 'data', 'creator-registrations.json'));
const STAFF_ROLE_IDS = [
    process.env.STAFF_ROLE_ID,
    process.env.TICKET_STAFF_ROLE_ID,
    ...String(process.env.CONTENT_STAFF_ROLE_IDS || '').split(','),
]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

let registrations = new Map();
let storeLoaded = false;

/** key -> { name used when creating, match = substring that identifies an existing channel } */
const CHANNELS = {
    start_here: { name: '👋-start-here', match: 'start-here' },
    apply: { name: '🚀-apply', match: 'apply' },
    account_setup: { name: '👤-account-setup', match: 'account-setup' },
    warmup: { name: '🔥-warmup', match: 'warmup' },
    dm_automation: { name: '📩-dm-automation', match: 'dm-automation' },
    payouts: { name: '💸-payouts', match: 'payouts' },
    content_bot: { name: '🎬-content-bot', match: 'content-bot' },
    payout_submission: { name: '💳-payout-submission', match: 'payout-submission' },
    referral: { name: '🤝-referral', match: 'referral' },
    support: { name: '🎟️-support', match: 'support' },
};

/** Channels that are linked or pinned by id, but never created by the bot. */
const NEVER_CREATE = ['content_bot', 'payout_submission', 'referral', 'support'];

/** Exact names of channels this bot created and no longer uses. */
const RETIRED_CHANNELS = ['🎬-formats'];

const embed = (title, description) => new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description);

function templates(link) {
    return {
        start_here: [
            embed(
                `💸 ${BRAND} — START HERE`,
                [
                    'Welcome to **Ecom Efficiency** 👋',
                    "You're just a few steps away from getting paid to post content.",
                    '',
                    "💰 **What You'll Earn**",
                    `• ${PAY_RATE}`,
                    '',
                    '🎯 **Your First 5 Actions**',
                    '',
                    `Create a brand new TikTok **and** Instagram account following ${link('account_setup')}`,
                    '',
                    `Register your accounts and enter payout details at ${link('apply')}`,
                    '',
                    `Warm up your accounts for 4 days ${link('warmup')}`,
                    '',
                    `Set up ${link('dm_automation')}`,
                    '',
                    `Start posting using ${link('content_bot')}`,
                ].join('\n')
            ),
        ],
        payouts: [
            embed(
                `💸 ${BRAND} — PAYOUTS`,
                [
                    PAY_RATE,
                    `Minimum views for payout: ${MIN_VIEWS}`,
                    `Minimum T1 audience for payout: ${MIN_T1}`,
                    '',
                    'Payouts are made by Bank Transfer, PayPal, or Cryptocurrency.',
                    'Payouts are made bi-weekly.',
                    '',
                    `Request payout? Go to ${link('payout_submission')}`,
                ].join('\n')
            ),
        ],
        account_setup: [
            embed(
                `💸 ${BRAND} — ACCOUNT SETUP`,
                [
                    '**Step 1: create an email address**',
                    'Create a new email address dedicated to your TikTok and Instagram accounts. Ideally use Gmail, Yahoo, Outlook or iCloud.',
                    "This is **your personal account**: you don't need to share your password or login details.",
                    '',
                    '**Step 2: create BOTH a TikTok and an Instagram account**',
                    'You need to create **one TikTok account and one Instagram account.**',
                    'Your account should look like it belongs to a real person documenting their e-commerce / online business journey, and NOT like an Ecom Efficiency promo account.',
                    '',
                    '**Name examples** (made-up ideas, not real accounts): @ecomwithannie, @anniebuildsastore, @lifewithannie, @anniesidehustle, @anniesecomjourney, @anniesnextchapter, @storewithannie.',
                    "There's **no strict naming requirement**. Do NOT use a name that is too promotional or directly centred on Ecom Efficiency.",
                    '',
                    "**Bio examples** — ***Don't add a bio until you've started posting your warm-up videos.***",
                    'Keep your bio natural and consistent with your persona:',
                    '• a 9–5 girl figuring out her side hustle',
                    '• e-commerce, side hustles & figuring life out',
                    '• documenting my 9–5 escape plan',
                    '• trying to make my first online sale 🤞',
                    '• ecom, life and everything in between',
                    '• just trying to survive the dropshipping grind',
                    '• looking for my next winning product 👀',
                    '',
                    "**Profile picture** — ***Don't add a profile picture until you've started your warm-up videos.***",
                    `Pick **one** profile picture from this folder: ${PROFILE_PICTURES}`,
                    "The account should look like a real person's, not a brand or an ad. Avoid Ecom Efficiency logos and promotional visuals.",
                    '',
                    '**⏰ Posting time:** post at US peak time, between **6pm and 12am ET**. Based in Asia? Post in your morning, the earlier the better.',
                    '',
                    '**✉️ Caption & hashtags:** first line = your CTA, e.g. `Check captions`, `ecomefficiency.com to get started`, or `Comment "AI" for the full guide`.',
                    'Use **3 to 5 hashtags**: 1–2 big (#ecommerce #dropshipping #makemoneyonline #sidehustle #onlinebusiness) + 2–3 niche (#shopifydropshipping #dropshippingtips #ecomtok #productresearch #winningproducts #tiktokshop). No #fyp / #viral.',
                ].join('\n')
            ),
        ],
        warmup: [
            embed(
                `💸 ${BRAND} — ACCOUNT WARM-UP (MANDATORY)`,
                [
                    '**The first 24 to 72 hours are crucial**',
                    'Before you post anything, you need to train your TikTok and Instagram accounts to understand your niche: **e-commerce + dropshipping + side hustles + making money online.**',
                    'Your search bar, your For You feed and your Explore page should gradually fill up with this type of content.',
                    '',
                    '⚠️ **DO NOT POST RIGHT AFTER CREATING THE ACCOUNT.**',
                    'Warm the accounts up for about **3 to 4 days before posting.**',
                    '',
                    '────────',
                    '**DAY 1**',
                    '',
                    '**Time required:** spend at least **45 to 60 minutes warming up EACH account.** You can split this up:',
                    '• 15 minutes in the morning',
                    '• 15 minutes in the afternoon',
                    '• then 15 to 30 minutes in the evening',
                    '',
                    '🧠 **Step 1: search and watch**',
                    'As soon as the account is created, manually search for content in your niche. Search in **your country\'s language or your native language**, plus English.',
                    '',
                    '**E-commerce / dropshipping:** dropshipping; how to start dropshipping; dropshipping for beginners; Shopify store; winning products; product research; TikTok Shop; e-commerce tips; first sale Shopify; dropshipping mistakes; Facebook ads for ecom; TikTok ads; store review.',
                    '',
                    '**Side hustle / 9–5:** side hustle; side hustle ideas; 9 to 5 life; quitting my 9 to 5; make money online; online business; passive income; work from home; entrepreneur life; ecom humour.',
                    '',
                    '**While watching:**',
                    '• watch videos **all the way through**;',
                    "• don't scroll quickly;",
                    '• engage naturally;',
                    '• prioritise relevant content;',
                    '• spot the creators who post regularly about e-commerce and online business.',
                    '',
                    'Spend about **45 to 60 minutes** on this.',
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — WARM-UP DAY 1 (ENGAGEMENT & FOLLOWS)`,
                [
                    '🔁 **Step 2: progressive engagement method**',
                    'After searching manually, switch to your For You feed or Explore page. On relevant content, mix: **copy link → repost → save → comment → like**.',
                    "Don't repeat exactly the same sequence on every video. Act like someone genuinely interested in e-commerce and building an online business.",
                    '',
                    '**Engagement target:** engage with at least **20 relevant videos** during the day: watch them fully, like them, save them, share or copy their link, repost them and leave genuine comments. Space your interactions out naturally.',
                    '**DO NOT SPAM** comments, likes, follows or shares all at once.',
                    '',
                    '💡 **Repost tip:** prioritise high-performing videos (ideally 500K+ views) directly related to your niche: funny dropshipping/ecom videos, side-hustle humour, viral winning-product videos, "first sale" stories, store reviews and online-business tips.',
                    '',
                    '**Follows — Day 1**',
                    "Follow **ONLY 5 accounts on the first day**. Prioritise creators who post regularly about e-commerce, dropshipping, side hustles or making money online. Don't mass-follow.",
                    '',
                    '**Examples of niche accounts to follow:**',
                    '• **@ac_hampton** — TikTok & Instagram (dropshipping / ecom mentor)',
                    '• **@officialsebghiorghiu** — TikTok (Sebastian Ghiorghiu, ecom & TikTok ads)',
                    '• **@jordanwelchyt** — TikTok (Jordan Welch, AI ecom)',
                    '• **@biaheza** — TikTok (dropshipping & online business)',
                    '• **@maddyglynn_** — TikTok (luxury dropshipping, "e-com girlie")',
                    '• **@dylanbusiness** — TikTok (Dylan Pearson, online business)',
                    '• **@theecomwolf** — TikTok (ecom business)',
                    '• **@dropshipping** — TikTok (winning products)',
                    '• **@ecom_with_moin** — Instagram (Shopify / FB ads / dropshipping)',
                    'Also look for smaller creators posting about ecom **in your country or in your native language**.',
                    '',
                    '**Check your feed**',
                    "After about **20 to 30 minutes**, your feed should naturally start showing videos about e-commerce, dropshipping and making money online. If it doesn't, go back to search, search the niche terms again, watch several videos all the way through, engage naturally, then go back to the feed. Repeat until the algorithm understands your niche.",
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — WARM-UP DAYS 2–4`,
                [
                    '**DAYS 2–3**',
                    'Keep going for **at least 45 to 60 minutes per day**. Search less manually and engage more from your feed. It should contain more and more dropshipping, e-commerce tips, side-hustle content, winning products, store reviews, ad breakdowns, online-business stories and 9–5 escape content.',
                    '',
                    "Every day, engage with at least **20 relevant videos**, watch them fully where possible, like, save, repost, comment and share naturally. Vary your habits and don't engage with every single video.",
                    '',
                    "Follow about **2 to 5 relevant accounts per day**. Don't suddenly follow dozens of accounts. Before you start posting, you should be following about **15 to 20+ relevant creators or accounts**.",
                    '',
                    '**Before your first post**',
                    'Aim for: **15 to 20 relevant accounts followed**, **20+ relevant videos saved**, several videos reposted, several genuine comments, replies or interactions where possible, and a feed mostly focused on e-commerce and making money online.',
                    '',
                    'The goal is for TikTok and Instagram to understand:',
                    '> **"This person is interested in e-commerce, dropshipping, side hustles and building an online business."**',
                    '',
                    '────────',
                    '**DAY 4 — Warm-up check**',
                    'After the 3 warm-up days, before posting your first video on day 4, **open a support ticket** and send the following so we can validate your warm-up:',
                    '',
                    '**TikTok**',
                    '• a screenshot of your screen time;',
                    '• **a 30-second screen recording of your For You feed**.',
                    '',
                    '**Instagram**',
                    '• a screenshot of your screen time;',
                    '• **a 30-second screen recording of your Explore/Reels feed**.',
                    '',
                    'This confirms that **BOTH TikTok AND Instagram have been warmed up properly.** Wait for our validation in the ticket before you start posting.',
                ].join('\n')
            ),
        ],
        dm_automation: [
            embed(
                `💸 ${BRAND} POSTING — DM AUTOMATION`,
                [
                    '**DM automation is mandatory on every post to get paid.**',
                    '',
                    '🎥 **Quick video to set up this automation:**',
                    DM_SETUP_VIDEO,
                    '',
                    '**What is DM automation?**',
                    'When someone comments a keyword under an Instagram post, they automatically receive a link by DM.',
                    '',
                    'To use it, switch your account to a professional account: Instagram settings → account type → professional / business account.',
                    '',
                    `Go to **Zorcha** (free): ${ZORCHA}`,
                    'Sign up and stay on the free plan.',
                    '',
                    'On every post, you must send the links via DM automation.',
                    '',
                    '**Keywords:** **Ecom** or **AI** depending on the post.',
                    '',
                    '**Caption:**',
                    'Check captions',
                    'Check captions to get started',
                    'ecomefficiency.com to get started',
                    '',
                    '**Guide to send:**',
                    DM_LINK,
                ].join('\n')
            ),
        ],
        referral: [
            embed(
                'Invite creators. Earn cash. 💸',
                [
                    'Know a creator who would be a great fit for Ecom Efficiency? Invite them and earn rewards based on the content they create.',
                    '',
                    '💰 **Earn $100 per referred creator**',
                    '',
                    '**How it works**',
                    '1. Invite the creator to this **Discord server**',
                    `2. They register in ${link('apply')} and start creating`,
                    '3. Their content reaches **100K views** in total',
                    `4. You open a ticket in ${link('support')} and **mention them** (@their Discord name)`,
                    '5. We verify their views → you get your **$100**',
                    '',
                    '**Example:**',
                    'You invite Sarah to the Discord → Sarah registers and creates 3 Ecom Efficiency videos → her first video gets 60K views, her second gets 30K, and her third gets 10K → **100K total views** → you open a ticket and mention @Sarah → you earn **$100**.',
                    '',
                    "⚠️ The creator must join through this Discord and register in the apply channel, otherwise we can't track your referral.",
                ].join('\n')
            ),
        ],
        apply: [
            embed(
                '🚀 Welcome to the Ecom Efficiency Creator Program',
                [
                    'Click the button below to begin your registration.',
                    '',
                    "**You'll be asked for:**",
                    '• TikTok username',
                    '• Instagram username',
                    '• Phone number',
                    '• Payout method (PayPal / Crypto / Bank Transfer)',
                    '• Payout details',
                    '',
                    "Once you register, the team reviews the notification. After approval you're in the program — warm up, post, and start earning.",
                ].join('\n')
            ),
        ],
    };
}

function registerRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.register).setLabel('Register').setEmoji('🚀').setStyle(ButtonStyle.Primary)
    );
}

async function resolveChannels(guild) {
    const all = await guild.channels.fetch().catch(() => guild.channels.cache);
    const text = [...all.values()].filter((c) => c?.type === ChannelType.GuildText);
    const anchor = text.find((c) => c.name.includes(CHANNELS.payout_submission.match));
    const resolved = {};
    for (const [key, spec] of Object.entries(CHANNELS)) {
        const pinned = PINNED_IDS[key] && all.get(PINNED_IDS[key]);
        const found =
            pinned ||
            text.find((c) => c.name.includes(spec.match) && !(key === 'payouts' && c.name.includes('submission')));
        if (found) {
            resolved[key] = found;
            continue;
        }
        if (NEVER_CREATE.includes(key)) continue;
        try {
            resolved[key] = await guild.channels.create({
                name: spec.name,
                type: ChannelType.GuildText,
                parent: anchor?.parentId || null,
                reason: 'Creator program channel',
            });
            console.log(`[CREATOR] Created #${spec.name} in ${guild.name}`);
        } catch (error) {
            console.warn(`[CREATOR] Could not create #${spec.name}:`, error?.message || error);
        }
    }
    return resolved;
}

/** Edit the bot's existing messages in order, send the missing ones, delete the extras. */
async function syncMessages(channel, botId, payloads) {
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const mine = recent ? [...recent.values()].filter((m) => m.author.id === botId).reverse() : [];
    for (const [index, payload] of payloads.entries()) {
        if (!mine[index]) await channel.send(payload);
        else if (!sameMessage(mine[index], payload)) await mine[index].edit(payload);
    }
    for (const extra of mine.slice(payloads.length)) await extra.delete().catch(() => {});
}

async function removeRetiredChannels(guild) {
    const all = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const channel of all.values()) {
        if (channel?.type !== ChannelType.GuildText || !RETIRED_CHANNELS.includes(channel.name)) continue;
        await channel
            .delete('Creator channel retired')
            .then(() => console.log(`[CREATOR] Deleted #${channel.name}`))
            .catch((error) => console.warn(`[CREATOR] Could not delete #${channel.name}:`, error?.message || error));
    }
}

async function publishCreatorChannels(client) {
    for (const guild of client.guilds.cache.values()) {
        await removeRetiredChannels(guild);
        const channels = await resolveChannels(guild);
        const link = (key) => (channels[key] ? `<#${channels[key].id}>` : `#${CHANNELS[key].name}`);
        for (const [key, embeds] of Object.entries(templates(link))) {
            const channel = channels[key];
            if (!channel) continue;
            const payloads = embeds.map((e) => ({ embeds: [e], components: [] }));
            if (key === 'apply') payloads[payloads.length - 1].components = [registerRow()];
            try {
                await syncMessages(channel, client.user.id, payloads);
                console.log(`[CREATOR] #${channel.name} up to date`);
            } catch (error) {
                console.warn(`[CREATOR] Could not publish in #${channel.name}:`, error?.message || error);
            }
        }
    }
}

function registrationModal() {
    const input = (id, label, placeholder, style = TextInputStyle.Short, maxLength = 100) =>
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId(id)
                .setLabel(label)
                .setPlaceholder(placeholder)
                .setStyle(style)
                .setRequired(true)
                .setMaxLength(maxLength)
        );
    return new ModalBuilder()
        .setCustomId(IDS.modal)
        .setTitle('Ecom Efficiency Creator Registration')
        .addComponents(
            input('tiktok', 'TikTok Username', '@yourhandle'),
            input('instagram', 'Instagram Username', '@yourhandle'),
            input('phone', 'Phone Number', '+1 555 555 5555', TextInputStyle.Short, 30),
            input('method', 'Payout Method', 'PayPal / Crypto / Bank Transfer'),
            input('details', 'Payout Details (email / wallet / bank)', 'your@email.com / wallet address / IBAN...', TextInputStyle.Paragraph, 1000)
        );
}

function clip(value, max = 1000) {
    const text = String(value || '').trim();
    if (!text || text === '—') return '—';
    return text.slice(0, max);
}

function handleOf(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/\s+/g, '');
}

function loadStore() {
    if (storeLoaded) return;
    storeLoaded = true;
    
    // Ensure parent directory exists
    try {
        fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    } catch (error) {
        console.warn('[CREATOR] Could not create store directory:', error?.message || error);
    }
    
    try {
        if (!fs.existsSync(STORE_PATH)) {
            console.log('[CREATOR] Store file does not exist yet, starting fresh.');
            registrations = new Map();
            return;
        }
        
        const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
        const list = Array.isArray(raw.registrations) ? raw.registrations : [];
        registrations = new Map(list.filter((row) => row?.discordId).map((row) => [String(row.discordId), row]));
        console.log(`[CREATOR] Loaded ${registrations.size} registration(s) from ${STORE_PATH}`);
    } catch (error) {
        console.warn('[CREATOR] Could not load store, starting fresh:', error?.message || error);
        registrations = new Map();
    }
}

function saveStore() {
    try {
        fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
        const data = JSON.stringify({ registrations: [...registrations.values()] }, null, 2);
        fs.writeFileSync(STORE_PATH, data, 'utf8');
        console.log(`[CREATOR] Saved ${registrations.size} registration(s) to ${STORE_PATH}`);
    } catch (error) {
        console.error('[CREATOR] FAILED to save store:', error?.message || error);
        console.error('[CREATOR] Store path:', STORE_PATH);
        console.error('[CREATOR] Data would be lost on restart!');
    }
}

function canReview(interaction) {
    const member = interaction.member;
    if (!member) return false;
    if (REVIEWER_ID && interaction.user?.id === REVIEWER_ID) return true;
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    const roles = member.roles?.cache ? [...member.roles.cache.keys()] : [];
    return roles.some((roleId) => STAFF_ROLE_IDS.includes(roleId));
}

function statusLabel(status) {
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    return 'Pending review';
}

function registrationEmbed(record) {
    const status = record.status === 'approved' ? 'approved' : record.status === 'rejected' ? 'rejected' : 'pending';
    const color = status === 'approved' ? 0x22c55e : status === 'rejected' ? 0xef4444 : COLOR;
    const title =
        status === 'approved' ? 'Creator application — approved' : status === 'rejected' ? 'Creator application — rejected' : 'New register';
    const who = record.discordUsername ? ` · @${record.discordUsername}` : '';
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`**Discord:** <@${record.discordId}> (\`${record.discordId}\`)${who}`)
        .addFields(
            { name: 'Discord Username', value: clip(record.discordUsername ? `@${record.discordUsername}` : '—', 100) },
            { name: 'TikTok Username', value: clip(record.tiktok, 100) },
            { name: 'Instagram Username', value: clip(record.instagram, 100) },
            { name: 'Phone Number', value: clip(record.phone, 40) },
            { name: 'Payout Method', value: clip(record.payoutMethod, 100) },
            { name: 'Payout Details', value: clip(record.payoutDetails, 1000) },
            { name: 'Status', value: statusLabel(status) },
            ...(record.validatedBy?.username
                ? [{ name: 'Validated by', value: clip(`@${record.validatedBy.username} (\`${record.validatedBy.id}\`)`, 200) }]
                : [])
        )
        .setFooter({ text: 'Ecom Efficiency Creator Registration' })
        .setTimestamp(record.appliedAt ? new Date(record.appliedAt) : new Date());
}

function reviewRow(discordId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${IDS.approve}:${discordId}`)
            .setLabel('Validate')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${IDS.reject}:${discordId}`).setLabel('Reject').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
}

function fieldMap(embed) {
    return Object.fromEntries((embed?.fields || []).map((field) => [field.name, String(field.value || '')]));
}

function recordFromMessage(message) {
    const embed = message.embeds?.[0];
    const title = embed?.title || '';
    if (!/register|creator application/i.test(title)) return null;
    if (/replaced/i.test(title)) return null;
    const fields = fieldMap(embed);
    if (!fields['TikTok Username'] && !fields['Instagram Username']) return null;
    const description = embed.description || '';
    const discordId = (description.match(/<@!?(\d+)>/) || [])[1];
    if (!discordId) return null;
    const fromDescription = (description.match(/· @(\S+)/) || [])[1] || '';
    const fromField = String(fields['Discord Username'] || '').replace(/^@/, '').split(/\s/)[0] || '';
    let status = 'pending';
    if (/approved/i.test(fields.Status || '') || /approved/i.test(title)) status = 'approved';
    else if (/rejected/i.test(fields.Status || '') || /rejected/i.test(title)) status = 'rejected';
    const validator = String(fields['Validated by'] || '');
    const validatorId = (validator.match(/`(\d+)`/) || [])[1] || '';
    const validatorName = (validator.match(/@(\S+)/) || [])[1] || '';
    return {
        discordId,
        discordUsername: fromField || fromDescription,
        discordGlobalName: '',
        tiktok: fields['TikTok Username'] || '—',
        instagram: fields['Instagram Username'] || '—',
        phone: fields['Phone Number'] || '—',
        payoutMethod: fields['Payout Method'] || '—',
        payoutDetails: fields['Payout Details'] || '—',
        status,
        appliedAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
        validatedAt: status === 'pending' ? null : message.editedAt?.toISOString?.() || null,
        validatedBy: validatorId ? { id: validatorId, username: validatorName } : null,
        messageId: message.id,
        channelId: message.channelId,
    };
}

function lookupEmbed(record) {
    return new EmbedBuilder()
        .setColor(record.status === 'approved' ? 0x22c55e : record.status === 'rejected' ? 0xef4444 : COLOR)
        .setTitle(`@${record.discordUsername || record.discordId}`)
        .setDescription(`**Status:** ${statusLabel(record.status)}\n**Discord:** <@${record.discordId}> (\`${record.discordId}\`)`)
        .addFields(
            { name: 'TikTok', value: clip(record.tiktok, 100), inline: true },
            { name: 'Instagram', value: clip(record.instagram, 100), inline: true },
            { name: 'Phone', value: clip(record.phone, 40), inline: true },
            { name: 'Payout method', value: clip(record.payoutMethod, 100) },
            { name: 'Payout details', value: clip(record.payoutDetails, 1000) },
            {
                name: 'Review',
                value: clip(
                    [
                        record.appliedAt ? `Applied ${record.appliedAt}` : '',
                        record.validatedAt ? `Updated ${record.validatedAt}` : '',
                        record.validatedBy?.username ? `By @${record.validatedBy.username}` : '',
                    ]
                        .filter(Boolean)
                        .join('\n') || '—',
                    300
                ),
            }
        )
        .setFooter({ text: 'Stored for future payouts' });
}

function findRegistrations(query) {
    loadStore();
    const needle = handleOf(query);
    if (!needle) return [];
    const exact = [];
    const partial = [];
    for (const record of registrations.values()) {
        const keys = [record.discordId, record.discordUsername, record.discordGlobalName, record.tiktok, record.instagram]
            .map(handleOf)
            .filter((key) => key && key !== '—');
        if (keys.includes(needle)) exact.push(record);
        else if (needle.length >= 3 && keys.some((key) => key.includes(needle))) partial.push(record);
    }
    return exact.length ? exact : partial;
}

async function fillDiscordName(client, record) {
    if (record.discordUsername) return record;
    const user = await client.users.fetch(record.discordId).catch(() => null);
    if (!user) return record;
    record.discordUsername = user.username || '';
    record.discordGlobalName = user.globalName || '';
    return record;
}

async function syncRegistrationLog(client) {
    loadStore();
    const initialSize = registrations.size;
    
    const channel = await client.channels.fetch(REGISTRATION_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
        console.warn('[CREATOR] Registration log channel not accessible');
        return;
    }

    const messages = [];
    let before;
    for (let page = 0; page < 10; page += 1) {
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
        if (!batch?.size) break;
        messages.push(...batch.values());
        before = batch.last()?.id;
        if (batch.size < 100) break;
    }
    messages.sort((a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

    const latest = new Map();
    for (const message of messages) {
        if (message.author?.id !== client.user?.id) continue;
        const parsed = recordFromMessage(message);
        if (!parsed) continue;
        const existing = registrations.get(parsed.discordId) || {};
        registrations.set(parsed.discordId, {
            ...existing,
            ...parsed,
            discordUsername: parsed.discordUsername || existing.discordUsername || '',
            discordGlobalName: existing.discordGlobalName || '',
            validatedBy: parsed.validatedBy || (parsed.status === 'pending' ? null : existing.validatedBy || null),
            validatedAt: parsed.status === 'pending' ? null : parsed.validatedAt || existing.validatedAt || null,
        });
        latest.set(parsed.discordId, message);
    }

    let fetched = 0;
    for (const record of registrations.values()) {
        if (record.discordUsername || fetched >= 40) continue;
        await fillDiscordName(client, record);
        fetched += 1;
    }
    
    // Save if we found new registrations
    if (registrations.size > initialSize) {
        console.log(`[CREATOR] Found ${registrations.size - initialSize} new registration(s) from Discord messages`);
        saveStore();
    } else if (registrations.size > 0) {
        console.log(`[CREATOR] Confirmed ${registrations.size} registration(s) from Discord log`);
    }

    for (const [discordId, message] of latest) {
        const record = registrations.get(discordId);
        if (!record || record.status !== 'pending' || record.messageId !== message.id) continue;
        const hasButtons = message.components?.some((row) =>
            row.components?.some((component) =>
                String(component.customId || component.custom_id || '').startsWith(`${IDS.approve}:`)
            )
        );
        if (hasButtons) continue;
        await message
            .edit({ embeds: [registrationEmbed(record)], components: [reviewRow(discordId)] })
            .catch((error) => console.warn('[CREATOR] Could not add validate buttons:', error?.message || error));
    }
    console.log(`[CREATOR] ${registrations.size} registration(s) stored for /${USERNAME_COMMAND}`);
    if (channel.guild) await backfillCreatorRoles(channel.guild);
}

/** Give the creator role to everyone who already applied (not rejected), and log why it fails. */
async function backfillCreatorRoles(guild, { quiet = false } = {}) {
    if (!CREATOR_ROLE_ID) return;
    const role = await guild.roles.fetch(CREATOR_ROLE_ID).catch(() => null);
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!role) {
        console.warn(`[CREATOR] Creator role ${CREATOR_ROLE_ID} not found in ${guild.name}.`);
        return;
    }
    const canManage = Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles));
    const above = Boolean(me && me.roles.highest.position > role.position);
    if (!quiet) {
        console.log(
            `[CREATOR] Role check: "${role.name}" pos ${role.position} · bot top role "${me?.roles.highest.name}" pos ${me?.roles.highest.position} · Manage Roles ${canManage ? 'yes' : 'NO'} · bot above role ${above ? 'yes' : 'NO'}`
        );
    }
    if (!canManage || !above) {
        console.warn('[CREATOR] Cannot grant the creator role: give the bot Manage Roles and move its role above the creator role.');
        return;
    }
    const counts = { granted: 0, already: 0, left: 0, failed: 0 };
    for (const record of registrations.values()) {
        if (record.status === 'rejected') continue;
        const member = await guild.members.fetch(record.discordId).catch(() => null);
        if (!member) {
            counts.left += 1;
            continue;
        }
        if (member.roles.cache.has(CREATOR_ROLE_ID)) {
            counts.already += 1;
            continue;
        }
        try {
            await member.roles.add(CREATOR_ROLE_ID, 'Creator application on file');
            counts.granted += 1;
        } catch (error) {
            counts.failed += 1;
            console.warn(`[CREATOR] Could not grant creator role to ${member.user.tag}:`, error?.message || error);
        }
    }
    if (!quiet || counts.granted || counts.failed) {
        console.log(
            `[CREATOR] Creator role backfill: ${counts.granted} granted, ${counts.already} already had it, ${counts.left} not in server, ${counts.failed} failed`
        );
    }
}

/** Re-run the backfill so creators who left and rejoined get the role back without a restart. */
function startCreatorRoleSync(client) {
    const timer = setInterval(async () => {
        loadStore();
        const channel = await client.channels.fetch(REGISTRATION_LOG_CHANNEL_ID).catch(() => null);
        if (!channel?.guild) return;
        await backfillCreatorRoles(channel.guild, { quiet: true }).catch((error) => {
            console.warn('[CREATOR] Creator role sync failed:', error?.message || error);
        });
    }, ROLE_SYNC_INTERVAL_MS);
    timer.unref?.();
}

async function grantCreatorRole(guild, userId, reason) {
    if (!CREATOR_ROLE_ID || !guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    if (member.roles.cache?.has(CREATOR_ROLE_ID)) return true;
    try {
        await member.roles.add(CREATOR_ROLE_ID, reason);
        return true;
    } catch (error) {
        console.warn(`[CREATOR] Could not grant creator role to ${member.user.tag}:`, error?.message || error);
        return false;
    }
}

async function submitRegistration(interaction) {
    // Role grant + staff notification can exceed Discord's 3 s reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const value = (id) => clip(interaction.fields.getTextInputValue(id));
    const record = {
        discordId: interaction.user.id,
        discordUsername: interaction.user.username || '',
        discordGlobalName: interaction.user.globalName || '',
        tiktok: value('tiktok'),
        instagram: value('instagram'),
        phone: value('phone'),
        payoutMethod: value('method'),
        payoutDetails: value('details'),
        status: 'pending',
        appliedAt: new Date().toISOString(),
        validatedAt: null,
        validatedBy: null,
        messageId: '',
        channelId: REGISTRATION_LOG_CHANNEL_ID,
    };
    loadStore();
    const previous = registrations.get(record.discordId);
    registrations.set(record.discordId, record);
    saveStore();

    const roleGranted = await grantCreatorRole(interaction.guild, interaction.user.id, 'Creator application submitted');

    const channel = await interaction.client.channels.fetch(REGISTRATION_LOG_CHANNEL_ID).catch(() => null);
    if (previous?.messageId && previous.status === 'pending' && channel?.messages?.fetch) {
        const previousMessage = await channel.messages.fetch(previous.messageId).catch(() => null);
        if (previousMessage) {
            const replaced = registrationEmbed({ ...previous, status: 'pending', validatedBy: null })
                .setColor(0x6b7280)
                .setTitle('Creator application — replaced')
                .spliceFields(6, 1, { name: 'Status', value: 'Replaced by a newer application' });
            await previousMessage.edit({ embeds: [replaced], components: [] }).catch(() => {});
        }
    }
    if (channel?.isTextBased?.()) {
        const sent = await channel
            .send({
                content: REVIEWER_ID ? `<@${REVIEWER_ID}>` : undefined,
                embeds: [registrationEmbed(record)],
                components: [reviewRow(record.discordId)],
                allowedMentions: { users: REVIEWER_ID ? [REVIEWER_ID] : [] },
            })
            .catch((error) => {
                console.warn('[CREATOR] Registration log failed:', error?.message || error);
                return null;
            });
        if (sent) {
            record.messageId = sent.id;
            registrations.set(record.discordId, record);
            saveStore();
        }
    }
    await interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('Application received')
                .setDescription(
                    roleGranted
                        ? 'Thanks — you now have access to the content generator. The team will review your application and DM you once it’s validated.'
                        : 'Thanks — the team will review it from the notification. You’ll get a DM once it’s validated.'
                ),
        ],
    });
}

async function reviewRegistration(interaction, status) {
    if (!canReview(interaction)) {
        await interaction.reply({ content: 'Only staff can validate creator applications.', flags: MessageFlags.Ephemeral });
        return;
    }
    const discordId = String(interaction.customId.split(':')[1] || '');
    loadStore();
    const fromMessage = recordFromMessage(interaction.message);
    const existing = registrations.get(discordId);
    if (existing?.messageId && existing.messageId !== interaction.message.id) {
        await interaction.message.edit({ components: [] }).catch(() => {});
        await interaction.reply({
            content: 'This notification was replaced by a newer application. Validate the latest one.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const source = fromMessage || existing;
    if (!source || (source.discordId && source.discordId !== discordId)) {
        await interaction.reply({ content: 'This notification has no application to validate.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (existing?.status === status || source.status === status) {
        await interaction.reply({
            content: status === 'approved' ? 'Already validated and stored.' : 'Already rejected.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const record = {
        ...(existing || {}),
        ...source,
        discordId,
        discordUsername: existing?.discordUsername || fromMessage?.discordUsername || '',
        discordGlobalName: existing?.discordGlobalName || '',
        status,
        appliedAt: existing?.appliedAt || fromMessage?.appliedAt || new Date().toISOString(),
        validatedAt: new Date().toISOString(),
        validatedBy: { id: interaction.user.id, username: interaction.user.username || 'staff' },
        messageId: interaction.message.id,
        channelId: interaction.channelId,
    };
    await fillDiscordName(interaction.client, record);
    registrations.set(discordId, record);
    saveStore();
    await interaction.message.edit({ embeds: [registrationEmbed(record)], components: [] }).catch(() => {});
    if (status === 'approved') await grantCreatorRole(interaction.guild, discordId, 'Creator application approved');

    const applicant = await interaction.client.users.fetch(discordId).catch(() => null);
    const dm =
        status === 'approved'
            ? "You're approved for the **Ecom Efficiency** Creator Program. Warm up your accounts, post, and your payout details are saved."
            : "Your **Ecom Efficiency** creator application wasn't approved this time.";
    const sent = await applicant?.send(dm).catch(() => null);

    await interaction.editReply(
        status === 'approved'
            ? `Validated and stored for payouts. Look them up with \`/username name:${record.discordUsername || discordId}\`.${sent ? '' : ' Could not DM them.'}`
            : `Rejected.${sent ? '' : ' Could not DM them.'}`
    );
}

/** Returns true when the interaction belonged to the creator channels. */
async function handleCreatorInteraction(interaction) {
    if (interaction.isButton() && interaction.customId === IDS.register) {
        await interaction.showModal(registrationModal());
        return true;
    }
    if (interaction.isModalSubmit() && interaction.customId === IDS.modal) {
        await submitRegistration(interaction);
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${IDS.approve}:`)) {
        await reviewRegistration(interaction, 'approved');
        return true;
    }
    if (interaction.isButton() && interaction.customId.startsWith(`${IDS.reject}:`)) {
        await reviewRegistration(interaction, 'rejected');
        return true;
    }
    return false;
}

function getUsernameSlashCommand() {
    return new SlashCommandBuilder()
        .setName(USERNAME_COMMAND)
        .setDescription('Look up a creator application and the payout details saved for them.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName('name')
                .setDescription('Discord, TikTok, or Instagram username')
                .setRequired(true)
                .setMaxLength(100)
        );
}

async function handleUsernameCommand(interaction) {
    if (!canReview(interaction)) {
        await interaction.reply({ content: 'Only staff can look up creator payout details.', flags: MessageFlags.Ephemeral });
        return;
    }
    const query = interaction.options.getString('name', true);
    if (registrations.size === 0) await syncRegistrationLog(interaction.client).catch(() => {});
    const matches = findRegistrations(query).slice(0, 5);
    if (!matches.length) {
        await interaction.reply({
            content: `No creator application stored for \`${query}\`. Validate one from the registration notification first.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    await interaction.reply({
        embeds: matches.map(lookupEmbed),
        flags: MessageFlags.Ephemeral,
    });
}

module.exports = {
    handleCreatorInteraction,
    publishCreatorChannels,
    getUsernameSlashCommand,
    handleUsernameCommand,
    syncRegistrationLog,
    startCreatorRoleSync,
    findRegistrations,
    USERNAME_COMMAND,
};
