/**
 * Creator-platform video submissions → staff review channel with
 * ✅ Approve / ✏️ Ask changes / ❌ Pass buttons. Decisions are applied on the
 * creator platform (the creator gets the platform notification with the feedback).
 *
 * Env:
 *   UGC_REVIEW_CHANNEL_ID   review channel (default 1560903018436755497)
 *   UGC_REVIEW_SECRET       shared secret, same value as DISCORD_REVIEW_BOT_SECRET on the creator API
 *   CREATOR_API_URL         creator API origin (decisions are POSTed to /api/v1/internal/discord-review/decide)
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { addRoute, isHostingEnabled, publishFiles } = require('./contentFiles');
const { isStaff } = require('./contentStudio');

const CHANNEL_ID = process.env.UGC_REVIEW_CHANNEL_ID || '1560903018436755497';
const SECRET = String(process.env.UGC_REVIEW_SECRET || '').trim();
const CREATOR_API_URL = String(process.env.CREATOR_API_URL || '').trim().replace(/\/+$/, '');
const PREFIX = 'ugcr';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

const COLORS = { pending: 0x3b82f6, approved: 0x22c55e, changes_requested: 0xf59e0b, rejected: 0xef4444 };
const DECISION_LABELS = {
    approved: '✅ Approved',
    changes_requested: '✏️ Changes requested',
    rejected: '❌ Passed',
};

function secretMatches(received) {
    if (SECRET.length < 32 || !received) return false;
    const expected = Buffer.from(SECRET);
    const actual = Buffer.from(String(received));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

function clip(text, max) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Discord upload ceiling for bots, by server boost tier. */
function uploadLimitBytes(guild) {
    const tier = guild?.premiumTier || 0;
    return (tier >= 3 ? 100 : tier === 2 ? 50 : 10) * 1024 * 1024;
}

async function downloadVideo(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`video download failed (${response.status})`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error('video too large to mirror');
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ugc-review-'));
    const file = path.join(dir, 'ugc.mp4');
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
    return { dir, file, size: (await fs.promises.stat(file)).size };
}

function reviewEmbed(payload) {
    const caption = clip(payload.caption, 1000) || '(none)';
    const embed = new EmbedBuilder()
        .setColor(COLORS.pending)
        .setTitle('UGC video to review')
        .addFields(
            { name: 'Creator', value: clip(payload.displayName, 200) || 'Creator', inline: true },
            { name: 'Email', value: clip(payload.email, 200) || '(missing)', inline: true },
            { name: 'Revision', value: String(payload.revision || 1), inline: true },
            { name: 'Caption', value: caption }
        )
        .setFooter({ text: `Submission ${payload.submissionId}` })
        .setTimestamp(new Date());
    if (/^https:\/\//.test(String(payload.staffReviewUrl || ''))) {
        embed.setURL(payload.staffReviewUrl);
    }
    return embed;
}

function reviewRow(submissionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${submissionId}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:changes:${submissionId}`).setLabel('Ask changes').setEmoji('✏️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${PREFIX}:pass:${submissionId}`).setLabel('Pass').setEmoji('❌').setStyle(ButtonStyle.Danger)
    );
}

async function postSubmission(client, payload) {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) {
        console.warn(`[UGC-REVIEW] Channel ${CHANNEL_ID} not found or not a text channel.`);
        return;
    }
    const message = {
        content: `🎬 **New UGC to review** — ${clip(payload.displayName, 100) || 'Creator'}`,
        embeds: [reviewEmbed(payload)],
        components: [reviewRow(payload.submissionId)],
        files: [],
    };
    let video = null;
    if (payload.videoUrl) {
        video = await downloadVideo(payload.videoUrl).catch((error) => {
            console.warn('[UGC-REVIEW] Could not download the video:', error?.message || error);
            return null;
        });
    }
    try {
        if (video && video.size <= uploadLimitBytes(channel.guild)) {
            message.files.push(new AttachmentBuilder(video.file, { name: 'ugc.mp4' }));
        } else if (video && isHostingEnabled()) {
            const hosted = await publishFiles([video.file], `UGC review — ${payload.displayName || 'Creator'}`);
            message.content += `\n▶️ Watch: ${hosted.files[0].url}`;
        } else if (!video) {
            message.content += '\n⚠️ Video preview unavailable, open it in the staff app (title link).';
        }
        await channel.send(message);
        console.log(`[UGC-REVIEW] Posted submission ${payload.submissionId}`);
    } finally {
        if (video) await fs.promises.rm(video.dir, { recursive: true, force: true }).catch(() => {});
    }
}

async function handleSubmissionPush(client, req, res) {
    if (!secretMatches(req.headers['x-review-secret'])) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }));
        return;
    }
    if (!client.isReady()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'BOT_NOT_READY' }));
        return;
    }
    let payload;
    try {
        payload = await readJson(req);
    } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'INVALID_INPUT' }));
        return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(payload?.submissionId || ''))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'INVALID_INPUT' }));
        return;
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    postSubmission(client, payload).catch((error) =>
        console.warn('[UGC-REVIEW] Could not post submission:', error?.message || error)
    );
}

async function decideOnPlatform(submissionId, decision, reason, user) {
    if (!CREATOR_API_URL || SECRET.length < 32) {
        return { ok: false, error: 'NOT_CONFIGURED' };
    }
    const response = await fetch(`${CREATOR_API_URL}/api/v1/internal/discord-review/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-review-secret': SECRET },
        body: JSON.stringify({
            submissionId,
            decision,
            reason,
            reviewer: { id: user.id, username: user.username || '' },
        }),
        signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({}));
    return { ...body, ok: Boolean(response.ok && body.ok) };
}

function decidedEmbed(message, decision, user, reason) {
    const base = message?.embeds?.[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder();
    base.setColor(COLORS[decision] || COLORS.pending).addFields({
        name: 'Decision',
        value: clip(`${DECISION_LABELS[decision] || decision} by <@${user.id}>${reason ? `\n${reason}` : ''}`, 1024),
    });
    return base;
}

const ERROR_TEXT = {
    NOT_CONFIGURED: 'The review bot is not connected to the creator platform yet (CREATOR_API_URL / UGC_REVIEW_SECRET missing).',
    SUBMISSION_NOT_FOUND: 'This submission no longer exists on the creator platform.',
    NO_WORKSPACE_ADMIN: 'No active admin found on the creator workspace to record the decision.',
    UNAUTHORIZED: 'The creator platform rejected the review secret. Check UGC_REVIEW_SECRET / DISCORD_REVIEW_BOT_SECRET.',
};

async function applyDecision(interaction, submissionId, decision, reason) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let result;
    try {
        result = await decideOnPlatform(submissionId, decision, reason, interaction.user);
    } catch (error) {
        console.warn('[UGC-REVIEW] Decision request failed:', error?.message || error);
        await interaction.editReply('Could not reach the creator platform. Try again in a moment.');
        return;
    }
    const message = interaction.message;
    if (result.ok) {
        await message?.edit({ embeds: [decidedEmbed(message, decision, interaction.user, reason)], components: [] }).catch(() => {});
        await interaction.editReply(`${DECISION_LABELS[decision]} — saved on the creator platform.`);
        return;
    }
    if (result.error === 'ALREADY_DECIDED') {
        const status = String(result.status || 'decided');
        await message
            ?.edit({
                embeds: [
                    (message.embeds?.[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder())
                        .setColor(COLORS[status] || 0x6b7280)
                        .addFields({ name: 'Decision', value: `Already handled on the platform (${status.replace(/_/g, ' ')})` }),
                ],
                components: [],
            })
            .catch(() => {});
        await interaction.editReply(`This video was already handled on the platform (${status.replace(/_/g, ' ')}).`);
        return;
    }
    await interaction.editReply(ERROR_TEXT[result.error] || `The creator platform refused the decision (${result.error || 'unknown error'}).`);
}

function feedbackModal(kind, submissionId) {
    const changes = kind === 'changes';
    return new ModalBuilder()
        .setCustomId(`${PREFIX}:${kind}-modal:${submissionId}`)
        .setTitle(changes ? 'Ask changes' : 'Pass on this video')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel(changes ? 'What should the creator change?' : 'Reason (sent to the creator)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(changes)
                    .setMaxLength(1000)
                    .setPlaceholder(changes ? 'e.g. Hook is too slow, show the product in the first 2 seconds' : 'Optional')
            )
        );
}

/** Returns true when the interaction belonged to the UGC review channel. */
async function handleUgcReviewInteraction(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith(`${PREFIX}:`)) return false;
    if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
    if (!isStaff(interaction)) {
        await interaction.reply({ content: 'Only staff can review UGC videos.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const [, action, submissionId] = id.split(':');
    if (interaction.isButton()) {
        if (action === 'approve') await applyDecision(interaction, submissionId, 'approved', '');
        else if (action === 'changes' || action === 'pass') await interaction.showModal(feedbackModal(action, submissionId));
        return true;
    }
    const reason = clip(interaction.fields.getTextInputValue('reason'), 1000);
    if (action === 'changes-modal') await applyDecision(interaction, submissionId, 'changes_requested', reason);
    else if (action === 'pass-modal') await applyDecision(interaction, submissionId, 'rejected', reason);
    return true;
}

function startUgcReview(client) {
    addRoute('POST', '/internal/ugc-review', (req, res) => handleSubmissionPush(client, req, res));
    const missing = [!CREATOR_API_URL && 'CREATOR_API_URL', SECRET.length < 32 && 'UGC_REVIEW_SECRET (32+ chars)'].filter(Boolean);
    console.log(
        `[UGC-REVIEW] Listening on POST /internal/ugc-review → channel ${CHANNEL_ID}${missing.length ? ` · missing ${missing.join(', ')}` : ''}`
    );
}

module.exports = { handleUgcReviewInteraction, startUgcReview };
