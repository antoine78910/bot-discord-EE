/**
 * /ee-content — staff-only content studio backed by the Python engine in ./content_engine.
 *   video      YouRy hook + Variator body + caption + music, iPhone 15 Pro .MOV signature
 *   carousel   5-slide EE carousel (JobShift engine), iPhone EXIF JPGs + ZIP
 *   cleanvideo strip metadata + subtle variation + iPhone signature on an uploaded video
 *   status     engine health (FFmpeg, hooks, avatar packs)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    PermissionsBitField,
    SlashCommandBuilder,
} = require('discord.js');
const { isHostingEnabled, publishFiles } = require('./contentFiles');

const CONTENT_COMMAND = 'ee-content';
const ENGINE_DIR = path.resolve(__dirname, 'content_engine');
const ENGINE_CLI = path.join(ENGINE_DIR, 'cli.py');
const AVATARS_DIR = path.join(ENGINE_DIR, 'carousel', 'assets', 'avatars');
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_ITEMS = 5;
const MAX_INPUT_VIDEO_BYTES = 200 * 1024 * 1024;
const COLORS = ['purple', 'pink', 'blue', 'green', 'cream'];

const STAFF_ROLE_IDS = [
    process.env.STAFF_ROLE_ID,
    process.env.TICKET_STAFF_ROLE_ID,
    ...String(process.env.CONTENT_STAFF_ROLE_IDS || '').split(','),
]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

function listAvatarPacks() {
    try {
        return fs
            .readdirSync(AVATARS_DIR, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()
            .slice(0, 25);
    } catch {
        return [];
    }
}

function getContentSlashCommand() {
    const packs = listAvatarPacks();
    return new SlashCommandBuilder()
        .setName(CONTENT_COMMAND)
        .setDescription('Staff: generate EcomEfficiency videos and carousels.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) =>
            sub
                .setName('variator')
                .setDescription('Variator video: caption banner + template with app steps + music.')
                .addIntegerOption((option) =>
                    option.setName('count').setDescription(`How many videos (1-${MAX_ITEMS})`).setMinValue(1).setMaxValue(MAX_ITEMS)
                )
                .addStringOption((option) =>
                    option
                        .setName('caption')
                        .setDescription('Force a caption (default: weighted pick from captions.txt)')
                        .setMaxLength(140)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('youry')
                .setDescription('YouRy clip: hook + body + music + text hook, with random variations.')
                .addIntegerOption((option) =>
                    option.setName('count').setDescription(`How many clips (1-${MAX_ITEMS})`).setMinValue(1).setMaxValue(MAX_ITEMS)
                )
        )
        .addSubcommand((sub) => {
            sub.setName('carousel')
                .setDescription('5-slide EE carousel, iPhone EXIF. Pick tools or best-business.')
                .addIntegerOption((option) =>
                    option.setName('count').setDescription('How many carousels (1-5)').setMinValue(1).setMaxValue(MAX_ITEMS)
                )
                .addStringOption((option) =>
                    option
                        .setName('style')
                        .setDescription('Layout (default: tools)')
                        .addChoices(
                            { name: 'Tools — avatar hook + app steps', value: 'tools' },
                            { name: 'Best business — stroke text', value: 'best-business' },
                            { name: 'Dropshipping is dead — stroke text', value: 'dead' },
                            { name: '5 steps — labels and logos', value: 'steps' }
                        )
                )
                .addStringOption((option) =>
                    option
                        .setName('color')
                        .setDescription('Text box color for the tools layout (default: purple)')
                        .addChoices(...COLORS.map((color) => ({ name: color, value: color })))
                );
            if (packs.length) {
                sub.addStringOption((option) =>
                    option
                        .setName('avatar')
                        .setDescription('Avatar pack for slide 1 (default: femme_noir)')
                        .addChoices(...packs.map((pack) => ({ name: pack, value: pack })))
                );
            }
            return sub;
        })
        .addSubcommand((sub) =>
            sub
                .setName('cleanvideo')
                .setDescription('Strip metadata, add subtle variations and an iPhone 15 Pro signature.')
                .addAttachmentOption((option) =>
                    option.setName('video').setDescription('MP4 / MOV file').setRequired(true)
                )
                .addBooleanOption((option) =>
                    option.setName('variation').setDescription('Apply subtle zoom/color/cut variations (default: yes)')
                )
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Check the content engine (FFmpeg, assets).'));
}

function isStaff(interaction) {
    const member = interaction.member;
    if (!member) return false;
    const permissions = member.permissions instanceof PermissionsBitField
        ? member.permissions
        : new PermissionsBitField(BigInt(member.permissions || 0));
    if (permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    const roles = member.roles?.cache
        ? [...member.roles.cache.keys()]
        : Array.isArray(member.roles) ? member.roles : [];
    return roles.some((roleId) => STAFF_ROLE_IDS.includes(roleId));
}

/** Size ceiling for renders (MB). With download links there is no Discord cap, so nothing is recompressed. */
function uploadLimitMb(guild) {
    if (isHostingEnabled()) return 4000;
    const tier = guild?.premiumTier || 0;
    if (tier >= 3) return 95;
    if (tier >= 2) return 48;
    return 9.5;
}

// One render at a time: the engine is CPU-bound and shares the bot's container.
let queueTail = Promise.resolve();
let queueLength = 0;

function enqueue(job) {
    queueLength += 1;
    const position = queueLength;
    const run = queueTail.then(job, job).finally(() => {
        queueLength -= 1;
    });
    queueTail = run.catch(() => {});
    return { position, run };
}

/** onProgress(current, total) fires on the engine's "[video 2/5]" / "[carousel 2/5]" stderr lines. */
function runEngine(args, onProgress) {
    return new Promise((resolve, reject) => {
        const child = spawn(PYTHON_BIN, [ENGINE_CLI, ...args], {
            cwd: ENGINE_DIR,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Content engine timed out.'));
        }, JOB_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            if (onProgress) {
                for (const match of text.matchAll(/^\[(?:variator|youry|carousel) (\d+)\/(\d+)\]/gm)) {
                    Promise.resolve(onProgress(Number(match[1]), Number(match[2]))).catch(() => {});
                }
            }
            stderr += text;
            if (stderr.length > 20000) stderr = stderr.slice(-20000);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new Error(`Could not start Python (${PYTHON_BIN}): ${error.message}`));
        });
        child.on('close', () => {
            clearTimeout(timer);
            const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
            try {
                resolve(JSON.parse(line));
            } catch {
                console.error('[CONTENT] engine stderr:', stderr.slice(-3000));
                reject(new Error('Content engine returned no result (check bot logs).'));
            }
        });
    });
}

function makeJobDir() {
    const dir = path.join(os.tmpdir(), 'ee-content', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function removeDir(dir) {
    fs.rm(dir, { recursive: true, force: true }, () => {});
}

function errorLines(result) {
    const errors = Array.isArray(result?.errors) ? result.errors : [];
    return errors.map((error) => `⚠️ ${String(error).slice(0, 300)}`).join('\n');
}

const VIDEO_LABELS = { variator: '🎞️ Variator video', youry: '✂️ YouRy clip' };

function linkRow(links) {
    return new ActionRowBuilder().addComponents(
        ...links.map(({ label, url }) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url))
    );
}

/** `send` posts one message (interaction.followUp, thread.send, ...). */
async function deliverVideos(send, result, prefix = '') {
    const items = result.items || [];
    for (const [index, item] of items.entries()) {
        const label = VIDEO_LABELS[item.type] || '🎬 Video';
        const header = `${prefix}${label} **${index + 1}/${items.length}** — ${item.duration}s · 📱 iPhone 15 Pro metadata`;
        if (isHostingEnabled()) {
            const hosted = await publishFiles([item.path], `${label} ${index + 1}/${items.length}`);
            await send({
                content: [header, ...(item.details || []), '⬇️ Download from the link below (full quality, do not re-download from Discord).'].join('\n'),
                components: [
                    linkRow([
                        { label: 'Download video', url: hosted.files[0].download },
                        { label: 'Watch', url: hosted.page },
                    ]),
                ],
            });
            continue;
        }
        await send({
            content: [header, ...(item.details || [])].join('\n'),
            files: [new AttachmentBuilder(item.path, { name: path.basename(item.path) })],
        });
    }
}

const MUSIC_DIR = path.join(ENGINE_DIR, 'youry', 'assets', 'clips', 'music');

function randomTrack() {
    try {
        const tracks = fs.readdirSync(MUSIC_DIR).filter((name) => /\.(mp3|m4a|wav|aac)$/i.test(name));
        return tracks.length ? path.join(MUSIC_DIR, tracks[Math.floor(Math.random() * tracks.length)]) : null;
    } catch {
        return null;
    }
}

/** Closing message of a carousel batch: one sound to use, or the platform's own suggestions. */
async function sendCarouselMusic(send) {
    const track = randomTrack();
    const tip = '🎵 **Music:** use this music for your carousel, or pick one TikTok / Instagram suggests you.';
    if (!track) {
        await send({ content: '🎵 **Music:** pick one TikTok / Instagram suggests you for your carousel.' });
        return;
    }
    if (isHostingEnabled()) {
        const hosted = await publishFiles([track], 'Carousel music');
        await send({ content: tip, components: [linkRow([{ label: 'Download music', url: hosted.files[0].download }])] });
        return;
    }
    await send({ content: tip, files: [new AttachmentBuilder(track, { name: path.basename(track) })] });
}

async function deliverCarousels(send, result, prefix = '') {
    const items = result.items || [];
    try {
        await deliverCarouselItems(send, items, prefix);
    } finally {
        if (items.length) await sendCarouselMusic(send).catch(() => {});
    }
}

async function deliverCarouselItems(send, items, prefix) {
    for (const [index, item] of items.entries()) {
        const slides = (item.slides || []).map(
            (slide) => new AttachmentBuilder(slide, { name: path.basename(slide) })
        );
        const DETAILS = {
            'best-business': 'Best business · stroke text · business class + lifestyle',
            dead: 'Dropshipping is dead · 10 slides',
            steps: '5 steps · white labels and logos',
        };
        const detail = DETAILS[item.style] || `avatar \`${item.avatar_pack}\` · color \`${item.color}\``;
        const header = [
            `${prefix}🖼️ **Carousel ${index + 1}/${items.length}** — ${detail} · 📱 iPhone EXIF`,
            `**Hook:** ${item.hook}`,
        ];
        if (isHostingEnabled()) {
            const hosted = await publishFiles([...(item.slides || []), item.zip], `Carousel ${index + 1}/${items.length} — ${item.hook}`);
            const zip = hosted.files[hosted.files.length - 1];
            await send({
                content: [...header, '👀 Previews below are recompressed by Discord. ⬇️ Download the originals from the links.'].join('\n'),
                files: slides,
                components: [
                    linkRow([
                        { label: 'Download ZIP (all slides)', url: zip.download },
                        { label: 'Open slides', url: hosted.page },
                    ]),
                ],
            });
            continue;
        }
        await send({
            content: header.join('\n'),
            files: slides,
        });
        await send({
            content: '📦 Original JPGs (download the ZIP, Discord previews are recompressed and lose the EXIF):',
            files: [new AttachmentBuilder(item.zip, { name: path.basename(item.zip) })],
        });
    }
}

async function downloadAttachment(attachment, dest) {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(dest, buffer);
}

function videoArgs(kind, count, jobDir, guild, caption = '') {
    const args = [kind, '--count', String(count), '--out', jobDir, '--max-mb', String(uploadLimitMb(guild))];
    if (caption && kind === 'variator') args.push('--caption', caption);
    return args;
}

function videoRunner(kind) {
    return async (interaction, jobDir) => {
        const count = interaction.options.getInteger('count') || 1;
        const caption = interaction.options.getString('caption') || '';
        const label = kind === 'variator' ? 'Variator video' : 'YouRy clip';
        await interaction.editReply(`⏳ Rendering **${count}** ${label}${count > 1 ? 's' : ''}…`);
        const result = await runEngine(videoArgs(kind, count, jobDir, interaction.guild, caption));
        const done = (result.items || []).length;
        await interaction.editReply(
            [`✅ **${done}/${count}** ${label}${count > 1 ? 's' : ''} ready.`, errorLines(result)].filter(Boolean).join('\n')
        );
        await deliverVideos((payload) => interaction.followUp(payload), result);
    };
}

async function runCarousel(interaction, jobDir) {
    const count = interaction.options.getInteger('count') || 1;
    const style = interaction.options.getString('style') || 'tools';
    const args = ['carousel', '--count', String(count), '--out', jobDir, '--style', style];
    const avatar = interaction.options.getString('avatar');
    const color = interaction.options.getString('color');
    if (avatar) args.push('--avatar', avatar);
    if (color) args.push('--color', color);
    await interaction.editReply(`⏳ Building **${count}** carousel${count > 1 ? 's' : ''}…`);
    const result = await runEngine(args);
    const done = (result.items || []).length;
    await interaction.editReply(
        [`✅ **${done}/${count}** carousel${count > 1 ? 's' : ''} ready.`, errorLines(result)].filter(Boolean).join('\n')
    );
    await deliverCarousels((payload) => interaction.followUp(payload), result);
}

async function runCleanVideo(interaction, jobDir) {
    const attachment = interaction.options.getAttachment('video', true);
    const name = String(attachment.name || '').toLowerCase();
    if (!/\.(mp4|mov|m4v)$/.test(name) && !String(attachment.contentType || '').startsWith('video/')) {
        await interaction.editReply('Please upload an `.mp4` or `.mov` video.');
        return;
    }
    if ((attachment.size || 0) > MAX_INPUT_VIDEO_BYTES) {
        await interaction.editReply('Video is too large (max 200 MB).');
        return;
    }
    const input = path.join(jobDir, `input${path.extname(name) || '.mp4'}`);
    await interaction.editReply('⏳ Downloading and cleaning the video…');
    await downloadAttachment(attachment, input);

    const args = ['cleanvideo', '--input', input, '--out', path.join(jobDir, 'out'), '--max-mb', String(uploadLimitMb(interaction.guild))];
    if (interaction.options.getBoolean('variation') === false) args.push('--no-variation');
    const result = await runEngine(args);
    const item = (result.items || [])[0];
    if (!item) {
        await interaction.editReply(`❌ Clean failed.\n${errorLines(result)}`);
        return;
    }
    const removed = (item.tags_removed || []).slice(0, 15).map((tag) => `\`${tag}\``).join(', ') || 'none';
    await interaction.editReply('✅ Video cleaned.');
    const content = [
        `🧼 **Clean video** — ${item.duration_before}s → ${item.duration_after}s · 📱 iPhone 15 Pro signature`,
        `**Removed tags:** ${removed}`,
        item.variation ? `**Variation:** ${item.variation}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    if (isHostingEnabled()) {
        const hosted = await publishFiles([item.path], 'Clean video');
        await interaction.followUp({
            content,
            components: [linkRow([{ label: 'Download video', url: hosted.files[0].download }, { label: 'Watch', url: hosted.page }])],
        });
        return;
    }
    await interaction.followUp({
        content,
        files: [new AttachmentBuilder(item.path, { name: path.basename(item.path) })],
    });
}

async function runStatus(interaction) {
    const result = await runEngine(['status']);
    const status = result.status || {};
    await interaction.editReply(
        [
            `**Content engine** ${result.ok ? '✅' : '❌'}`,
            `FFmpeg: ${status.ffmpeg ? '✅' : '❌ missing'}`,
            `Variator: **${status.variator?.templates ?? 0}** templates · **${status.variator?.music ?? 0}** sounds`,
            `YouRy: **${status.youry?.hooks ?? 0}** hooks · **${status.youry?.bodies ?? 0}** bodies · **${status.youry?.music ?? 0}** tracks · **${status.youry?.text_hooks ?? 0}** text hooks`,
            `Avatar packs: ${(status.avatar_packs || []).map((pack) => `\`${pack}\``).join(', ') || 'none'}`,
            `Sample caption: ${status.sample_caption || '—'}`,
            errorLines(result),
        ]
            .filter(Boolean)
            .join('\n')
    );
}

async function handleContentCommand(interaction) {
    if (!interaction.guild) {
        await interaction.reply({ content: 'Run this in the server.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!isStaff(interaction)) {
        await interaction.reply({ content: 'This command is reserved for staff.', flags: MessageFlags.Ephemeral });
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (subcommand === 'status') {
        await runStatus(interaction);
        return;
    }

    const handlers = {
        variator: videoRunner('variator'),
        youry: videoRunner('youry'),
        carousel: runCarousel,
        cleanvideo: runCleanVideo,
    };
    const handler = handlers[subcommand];
    if (!handler) {
        await interaction.editReply('Unknown subcommand.');
        return;
    }

    const { position, run } = enqueue(async () => {
        const jobDir = makeJobDir();
        try {
            await handler(interaction, jobDir);
        } catch (error) {
            console.error(`[CONTENT] ${subcommand} failed:`, error);
            await interaction.editReply(`❌ ${subcommand} failed: ${error?.message || 'unknown error'}`).catch(() => {});
        } finally {
            removeDir(jobDir);
        }
    });
    if (position > 1) {
        await interaction.editReply(`🕒 Queued (position ${position}). Another render is running…`);
    }
    await run;
}

module.exports = {
    CONTENT_COMMAND,
    MAX_ITEMS,
    deliverCarousels,
    deliverVideos,
    enqueue,
    errorLines,
    getContentSlashCommand,
    handleContentCommand,
    isStaff,
    makeJobDir,
    removeDir,
    runEngine,
    uploadLimitMb,
    videoArgs,
};
