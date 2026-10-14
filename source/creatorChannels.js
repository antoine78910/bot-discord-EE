/**
 * Creator program channels (port of the YouRy bot's channel templates, adapted to Ecom Efficiency).
 * On startup each channel is found by name (or created next to #payout-submission) and its bot
 * messages are edited in place, so restarts never duplicate them.
 *
 * Copy source: Notion "Ecom Efficiency Account Setup & Warm-Up Guide" + "Ecom Efficiency Formats".
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
const PAY_RATE = process.env.CREATOR_PAY_RATE || '$300 per 1M views';
const MIN_VIEWS = process.env.CREATOR_MIN_VIEWS || '100k views';
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
    formats: { name: '🎬-formats', match: 'formats' },
    dm_automation: { name: '📩-dm-automation', match: 'dm-automation' },
    payouts: { name: '💸-payouts', match: 'payouts' },
    content_bot: { name: '🎬-content-bot', match: 'content-bot' },
    payout_submission: { name: '💳-payout-submission', match: 'payout-submission' },
};

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
                    `Pick a format in ${link('formats')} and set up ${link('dm_automation')}`,
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
                    '**1. Create a new email** dedicated to your TikTok and Instagram (Gmail, Yahoo, Outlook or iCloud). It stays **your** account — no need to share your login.',
                    '',
                    '**2. Create BOTH a TikTok and an Instagram account.** It must look like a real person documenting their ecom / online business journey, NOT an Ecom Efficiency promo account.',
                    '',
                    '**Username examples:** @ecomwithannie, @anniebuildsastore, @lifewithannie, @anniessidehustle, @anniesecomjourney, @storewithannie',
                    'No strict naming rule — just never too promotional or centred on Ecom Efficiency.',
                    '',
                    "**Bio** *(only once you've started posting your warm-up videos)*:",
                    '• a 9–5 girl figuring out her side hustle',
                    '• e-commerce, side hustles & figuring life out',
                    '• documenting my 9–5 escape plan',
                    '• trying to make my first online sale 🤞',
                    '• just trying to survive the dropshipping grind',
                    '• looking for my next winning product 👀',
                    '',
                    "**Profile picture** *(only once you've started your warm-up videos)*: a natural photo of your face. No Ecom Efficiency logos, stock photos, AI photos or promo visuals.",
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
                `💸 ${BRAND} — WARM UP`,
                [
                    '💡 **Warm-Up Guide — MANDATORY**',
                    '',
                    'Before posting anything, train your TikTok **and** Instagram to understand your niche: **e-commerce + dropshipping + side hustles + making money online.** Your search bar, For You feed and Explore page should fill up with this content.',
                    '',
                    '⚠️ **DO NOT POST RIGHT AFTER CREATING THE ACCOUNT.** Warm up for about **3 to 4 days** first.',
                    '',
                    '────────',
                    '',
                    '**DAY 1 — 45 to 60 min per account** (e.g. 15 min morning, 15 min afternoon, 15–30 min evening)',
                    '',
                    '🧠 **Search and watch** — in your native language **and** English:',
                    '• dropshipping, how to start dropshipping, Shopify store, winning products, product research, TikTok Shop, first sale Shopify, TikTok ads',
                    '• side hustle, 9 to 5 life, quitting my 9 to 5, make money online, online business, passive income, ecom humour',
                    '',
                    'Watch videos **all the way through**, don\'t scroll fast, engage naturally.',
                    '',
                    '🔁 **Progressive engagement** — then switch to your For You / Explore feed and mix **copy link → repost → save → comment → like** on at least **20 relevant videos**. Vary the order, space it out, **DO NOT SPAM**.',
                    '',
                    '💡 Repost high-performing niche videos (ideally 500K+ views): ecom humour, winning-product videos, "first sale" stories, store reviews.',
                    '',
                    '**Follow ONLY 5 accounts on day 1**, e.g. @ac_hampton, @officialsebghiorghiu, @jordanwelchyt, @biaheza, @maddyglynn_, @dylanbusiness, @theecomwolf, @ecom_with_moin — plus smaller ecom creators from your country.',
                    '',
                    'After 20–30 min your feed should show ecom / dropshipping content. If not: search again, watch fully, engage, go back to the feed.',
                ].join('\n')
            ),
            embed(
                `💸 ${BRAND} — WARM UP (DAYS 2–6)`,
                [
                    '**DAYS 2–3 — 45 to 60 min per day**',
                    '• Search less, engage more from your feed',
                    '• At least **20 relevant videos** a day: watch, like, save, repost, comment, share — naturally',
                    '• Follow **2 to 5** relevant accounts a day (never dozens at once)',
                    '',
                    '**Before your first post, aim for:** 15–20 relevant accounts followed, 20+ videos saved, several reposts and genuine comments, and a feed mostly about ecom and making money online.',
                    '',
                    '────────',
                    '',
                    '**DAY 4 — Warm-up check** — before posting, send in the Discord:',
                    '• **TikTok:** screen-time screenshot + **30-second screen recording of your For You feed**',
                    '• **Instagram:** screen-time screenshot + **30-second screen recording of your Explore/Reels feed**',
                    '',
                    '**DAYS 4, 5 and 6 — Warm-up posts:** once you get the go-ahead, post **ONE** 6–7 second video a day with on-screen text. Not promotional — it just steers your account to the right audience.',
                    '',
                    '────────',
                    '',
                    '**Every day after that**',
                    '• Before each post, scroll niche content and mix **SHARE → SAVE → COMMENT → LIKE**',
                    '• Watch videos fully (2× speed for long ones), space comments out, no spam, no mass-follow',
                    '• Keep following **2 to 3** relevant accounts a day and keep engaging after posting',
                    '',
                    '**Mindset:** Problem → relatable story → discovery → Ecom Efficiency demo → result.',
                    'People should think *"Wait… I need this for my store"*, not *"I\'m watching an ad"*.',
                ].join('\n')
            ),
        ],
        formats: [
            embed(
                '🎬 FORMAT 1 — AI dropshipping, beginner edition',
                [
                    '**Length:** 110–130 s · **Style:** talking head + narrated screen recording',
                    '**Reference:** [TikTok](https://www.tiktok.com/@shon.ecom/video/7646967914221931806)',
                    '',
                    '**0–5 s — Hook (on camera):** "AI dropshipping, beginner edition. Here\'s exactly how to get your first sale in 2026, and no, I\'m not selling you a course." · Title on screen: *AI dropshipping - beginner edition*',
                    '',
                    `**5–35 s — Find a product:** open [Ecom Efficiency Tools](${TOOLS}) → **Kalodata** → Products, "Last 30 days" + "Top sales" (already default) → show one of the top 6 (don't click it).`,
                    '',
                    '**35–75 s — Build a store:** find that product on AliExpress → copy the link → Ecom Efficiency → **DropMagic** → paste the link → show the store already generated on the dashboard (no need to create a new one).',
                    '',
                    '**75–110 s — Ads:** **Youry** → Link to Ad → paste the product link → show the UGC ad. If time allows: Workflow → static-ad template → show the ad images.',
                    '',
                    '**110–130 s — Recap + CTA (on camera):** "You don\'t want to pay for each tool, so go to Ecom Efficiency to get them all. Comment **"Ecom"** and I\'ll send you the full step-by-step workflow."',
                ].join('\n')
            ),
            embed(
                '🎬 FORMAT 2 — Best AI ecom tools in 2026',
                [
                    '**Length:** 15–20 s · **Style:** fast edit, one question per tool, switch side and show the tool logo each time',
                    '**Reference:** [TikTok](https://www.tiktok.com/@maverickgpt/video/7610593427536891167) · **Title:** "Best AI tools for ecom in 2026"',
                    '',
                    'Do you want to remove subtitles from any video? Use this. *(VMake)*',
                    'Do you want to find winning products? Use this. *(Kalodata)*',
                    'Do you want to spy on the best TikTok and Meta ads? Use this. *(PiPiAds)*',
                    'Do you want to catch trends before everyone else? Use this. *(Exploding Topics)*',
                    'Do you want your store to rank on Google and AI? Use this. *(Semrush)*',
                    'Do you want AI UGC ads without hiring creators? Use this. *(Youry)*',
                    'Do you want to build your store in one minute? Use this. *(DropMagic)*',
                    'Do you want all of these tools in one place? Use this. *(Ecom Efficiency)*',
                    'Save and follow for more.',
                ].join('\n')
            ),
            embed(
                '🎬 FORMAT 3 — AI dropshipping is going crazy right now',
                [
                    '**Length:** 45–75 s · **Style:** talking-head intro, screen demo, back to camera',
                    '**Reference:** [TikTok](https://www.tiktok.com/@jaden.drops/video/7562697983792352542)',
                    '',
                    '1. **On camera:** "AI dropshipping is going crazy right now, so I\'m going to show you how to start as a beginner."',
                    '2. "First you need a winning product, so go to this website with 50+ ecom tools. I\'m choosing **Kalodata** — it tracks what\'s selling on TikTok Shop." · Turn the camera to the Ecom Efficiency tools.',
                    '3. "Go to Products, filter last 30 days and top sales. I\'m choosing this product." · Pick one of the top 6.',
                    '4. "Then go to AliExpress and find that exact product." · Show the AliExpress page.',
                    '5. "Copy the link, come to this tool and paste it — it creates a beautiful product page with AI." · **DropMagic** → new store → paste → generate. *Don\'t wait: open the store already created on the dashboard.*',
                    '6. "Last thing: your ads. Open **Youry**, Workflow, this template, swap in your product photo and site link, and it creates winning ads." · Workflow → Static Ad template → show inputs + result.',
                    '7. **Back on camera:** "Then launch your ads and watch the sales come in. Comment **"AI"** and I\'ll send you the workflow and the tools I used."',
                ].join('\n')
            ),
            embed(
                "🎬 FORMAT 4 — I'm deleting this video in 24 hours",
                [
                    '**Length:** 30–50 s · **Style:** talking-head hook, narrated discovery, quick demo, back to camera',
                    '',
                    '> I\'m deleting this video in 24 hours because I just found a crazy hack, and honestly, I don\'t want it to get too much attention.',
                    '> So basically, someone just created this website where you get access to 50+ ecom tools — basically everything you need to run an ecom store.',
                    "> You've got Higgsfield for AI video, ElevenLabs for AI voiceovers, Kalodata to find winning products, Vmake to remove subtitles, Dropmagic to build your store in minutes, and a ton more.",
                    "> And the crazy part is, you just click on the tool and you're in. Nothing else.",
                    "> And you don't have to pay for each of these expensive subscriptions separately.",
                    '> So comment **"AI"** and I\'ll send you **for free the full workflow** to start AI dropshipping in 2026.',
                    '',
                    '**Editing:** at "So basically…" turn the camera to the website and show each tool as you name it · at "you just click" click on Dropmagic · at "So comment…" back to camera.',
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
        if (mine[index]) await mine[index].edit(payload);
        else await channel.send(payload);
    }
    for (const extra of mine.slice(payloads.length)) await extra.delete().catch(() => {});
}

async function publishCreatorChannels(client) {
    for (const guild of client.guilds.cache.values()) {
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
