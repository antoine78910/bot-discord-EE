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
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { sameMessage } = require('./discordSync');

const COLOR = 0x8b5cf6;
const BRAND = 'ECOM EFFICIENCY CREATORS';
const SITE = 'https://www.ecomefficiency.com';
const TOOLS = 'https://app.ecomefficiency.com/tools';
const ZORCHA = 'https://zorcha.com/';
const DM_SETUP_VIDEO = 'https://player.mediadelivery.net/play/776484/e2aa021a-927d-4727-abb0-dc95b4935b04';
const DM_LINK = 'https://docs.google.com/document/d/1h4iUz5icf6Vp1w96mH3bAW7eRBifaOQfahFfwyCMOiU/edit?usp=drive_link';
const REGISTRATION_LOG_CHANNEL_ID =
    process.env.CREATOR_REGISTRATION_LOG_CHANNEL_ID || process.env.CONTENT_INFO_CHANNEL_ID || '1556165339413352518';
const REVIEWER_ID = process.env.CONTENT_REVIEWER_ID || process.env.OWNER_USER_ID || '';
const PAY_RATE = process.env.CREATOR_PAY_RATE || '$500 per 500k views';
const MIN_VIEWS = process.env.CREATOR_MIN_VIEWS || '1k views';
const WARMUP_GUIDE = 'https://app.notion.com/p/Account-setup-Warm-up-Guide-d9c6d9521ad240758b815fb5e26f4f39';
const MIN_T1 = process.env.CREATOR_MIN_T1 || '20%';
const PINNED_IDS = (() => {
    try {
        return JSON.parse(process.env.CREATOR_CHANNEL_IDS || '{}');
    } catch {
        return {};
    }
})();

const IDS = { register: 'ee_creator_register', modal: 'ee_creator_register_modal' };

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
};

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
                    `Warm up your accounts for 3 days ${link('warmup')}`,
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
                `💸 ${BRAND} — WHAT IS ECOM EFFICIENCY?`,
                [
                    'Ecom Efficiency is an all-in-one subscription for e-commerce and dropshipping: one membership gives access to **50+ AI, spy and SEO tools** that sellers normally pay for one by one.',
                    '',
                    '• **Spy & ad-intelligence:** find winning products and competitor ads (PiPiADS, Foreplay, WinningHunter, Kalodata)',
                    '• **AI tools:** create content, creatives and copy faster',
                    '• **SEO tools:** research keywords and improve store visibility',
                    '• **One subscription** instead of paying for every tool',
                    '',
                    '**Who are you?** Someone starting an online business, building a Shopify / dropshipping store, chasing a side hustle, or tired of how expensive ecom tools are.',
                    '',
                    'Your content should speak to people who test product after product without a sale, scroll for hours for "winning products", pay for 5–10 tool subscriptions, build a store next to a 9–5, or feel like every guru hides their real tools.',
                    '',
                    '**Best content = relatable, personal, funny and slightly dramatic.**',
                    '> "POV: I stopped paying for 10 different ecom tools."',
                    '> "Ecom got so expensive that I found a way to get all the spy tools for the price of one."',
                    '',
                    '**Tone:** make it feel like a discovery — NOT an ad. The viewer should think *"Wait… you can actually do that?"*',
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — PLATFORM SETUP`,
                [
                    '**1. Open your invitation link** — we send you a personal invitation link to the sign-up page. Expired? Message us for a new one.',
                    `*(Website: ${SITE})*`,
                    '',
                    '**2. Create your account** from that page. Your invitation gives you free access to Ecom Efficiency.',
                    '',
                    '**3. Explore the platform before filming.** Make sure you know how to:',
                    '• log in and browse the tool catalogue',
                    '• open a spy tool and find a product or ad',
                    "• show a competitor's ads or a \"winning product\"",
                    '• use one of the AI tools and one of the SEO tools',
                    '• explain that all of this is included in one subscription',
                    '',
                    '**IMPORTANT:** get familiar with the platform first so your demos look natural.',
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — ACCOUNT SETUP`,
                [
                    `📖 **Full guide (source):** ${WARMUP_GUIDE}`,
                    '',
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
                    "Use a **natural photo of your face**. The account should look like a real person's, not a brand or an ad.",
                    'Avoid Ecom Efficiency logos, stock photos, AI-generated photos and promotional visuals.',
                    '',
                    '**⏰ Posting time:** post at US peak time, between **6pm and 12am ET**. Based in Asia? Post in your morning, the earlier the better.',
                    '',
                    '**✉️ Caption & hashtags:** first line = your CTA, e.g. `Comment "AI" for the full workflow` or `Comment "Ecom" for the full guide`.',
                    'Use **3 to 5 hashtags**: 1–2 big (#ecommerce #dropshipping #makemoneyonline #sidehustle #onlinebusiness) + 2–3 niche (#shopifydropshipping #dropshippingtips #ecomtok #productresearch #winningproducts #tiktokshop). No #fyp / #viral.',
                ].join('\n')
            ),
        ],
        warmup: [
            embed(
                `💸 ${BRAND} — ACCOUNT WARM-UP (MANDATORY)`,
                [
                    `📖 **Full guide (source):** ${WARMUP_GUIDE}`,
                    '',
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
                    'After the 3 warm-up days, before posting your first video on day 4, send the following in the Discord group:',
                    '',
                    '**TikTok**',
                    '• a screenshot of your screen time;',
                    '• **a 30-second screen recording of your For You feed**.',
                    '',
                    '**Instagram**',
                    '• a screenshot of your screen time;',
                    '• **a 30-second screen recording of your Explore/Reels feed**.',
                    '',
                    'This confirms that **BOTH TikTok AND Instagram have been warmed up properly.**',
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — RULES, HASHTAGS & WARM-UP POSTS`,
                [
                    '**TikTok + Instagram rules and best practices**',
                    "Before each post, scroll through niche content and naturally mix: **SHARE → SAVE → COMMENT → LIKE**. You don't need to do every action on every video.",
                    '',
                    "Watch videos fully when possible; use **2×** speed for long videos; space your comments several minutes apart; don't spam; don't mass-follow; vary the order of your interactions; keep following about **2 to 3 relevant accounts per day** once you've started posting, and keep engaging with niche content after posting.",
                    '',
                    '**Hashtags**',
                    'Use **3 to 5 hashtags per post** (TikTok currently limits posts to 5 hashtags). Mix 1–2 big tags with 2–3 niche tags that match the video:',
                    '• **Big / broad:** #ecommerce #dropshipping #makemoneyonline #sidehustle #onlinebusiness',
                    '• **Niche:** #shopifydropshipping #dropshippingtips #ecommercetips #ecomtok #shopify #productresearch #winningproducts #tiktokshop #ecom #sidehustleideas',
                    'Prioritise relevance over size, and avoid generic tags like #fyp or #viral.',
                    '',
                    '**Warm-up posts**',
                    "Once you've been given the go-ahead to start posting, post ONE warm-up video per day for the next 3 days (days 4, 5 and 6).",
                    "These videos are not promotional: they're simply 6–7 second videos with on-screen text to steer your account towards the right audience.",
                    '',
                    '────────',
                    '**Mindset for Ecom Efficiency content**',
                    '**Problem → relatable story → discovery → Ecom Efficiency demo → result**',
                    '',
                    '**Problem:** "I tested 6 products this month and I\'m genuinely losing my mind (and my money on tools)."',
                    '**Discovery:** "Then I found a platform that gives you all the ecom tools in one subscription."',
                    "**Demo:** show yourself opening a spy tool and finding a product or a competitor's ads.",
                    '**Value:** "Instead of paying for every spy, AI and SEO tool separately, I get them all in one place."',
                    '**Reaction:** "Now I do my product research from my bed instead of paying for ten different tools."',
                    '',
                    'The content should make people think:',
                    '> **"Wait… I need this for my store."**',
                    'and not:',
                    '> **"I\'m watching an ad for an ecom tool."**',
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
                    'Comment “AI” to try it!',
                    'Comment “AI” for the method',
                    'Comment “AI” for the link',
                    '_(the keyword must match the links configured below)_',
                    '',
                    '**Website link to send (all buttons):**',
                    DM_LINK,
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
                    "Once you register, you're officially in the program — warm up, post, and start earning.",
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
        if (key === 'content_bot' || key === 'payout_submission') continue;
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

async function submitRegistration(interaction) {
    const value = (id) => interaction.fields.getTextInputValue(id) || '—';
    const log = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('New register')
        .setDescription(`**Discord:** ${interaction.user} (\`${interaction.user.id}\`)`)
        .addFields(
            { name: 'TikTok Username', value: value('tiktok') },
            { name: 'Instagram Username', value: value('instagram') },
            { name: 'Phone Number', value: value('phone') },
            { name: 'Payout Method', value: value('method') },
            { name: 'Payout Details', value: value('details') }
        )
        .setFooter({ text: 'Ecom Efficiency Creator Registration' })
        .setTimestamp();
    const channel = await interaction.client.channels.fetch(REGISTRATION_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased?.()) {
        await channel
            .send({
                content: REVIEWER_ID ? `<@${REVIEWER_ID}>` : undefined,
                embeds: [log],
                allowedMentions: { users: REVIEWER_ID ? [REVIEWER_ID] : [] },
            })
            .catch((error) => console.warn('[CREATOR] Registration log failed:', error?.message || error));
    }
    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLOR)
                .setTitle('✅ Registration complete')
                .setDescription("You're officially in the **Ecom Efficiency** Creator Program."),
        ],
        flags: MessageFlags.Ephemeral,
    });
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
    return false;
}

module.exports = { handleCreatorInteraction, publishCreatorChannels };
