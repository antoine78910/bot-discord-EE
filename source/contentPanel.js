/**
 * "Create Content" panel (YouRy-style) for the EE content bot.
 * Panel button -> ephemeral picker (video / carousel / batch) -> render queue -> private thread per user.
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
const {
    deliverCarousels,
    deliverVideos,
    enqueue,
    errorLines,
    isStaff,
    makeJobDir,
    removeDir,
    runEngine,
    uploadLimitMb,
} = require('./contentStudio');

const PANEL_CHANNEL_ID = process.env.CONTENT_PANEL_CHANNEL_ID || '1556165419184816219';
const PANEL_COLOR = 0x8b5cf6;
const PROGRESS_COLOR = 0x5865f2;
const DONE_COLOR = 0x57f287;
const MAX_BATCH = 5;

const IDS = {
    open: 'ee_content_open',
    video: 'ee_content_video',
    carousel: 'ee_content_carousel',
    batchVideo: 'ee_content_batch_video',
    batchCarousel: 'ee_content_batch_carousel',
    modalPrefix: 'ee_content_modal:',
    countInput: 'ee_content_count',
};

const KIND_LABEL = { video: 'video', carousel: 'carousel' };

function panelEmbed() {
    return new EmbedBuilder()
        .setTitle('🎬 Content Generator')
        .setColor(PANEL_COLOR)
        .setDescription(
            [
                'Click **Create Content**, then pick what you want.',
                '',
                '🎬 **Video**: hook clip + Ecom Efficiency tools + caption + music',
                '🖼️ **Carousel**: 5 slides (avatar hook, 3 tools, Ecom Efficiency recap) + ZIP',
                '📦 **Batch**: up to 5 at once, all different',
                '',
                'Every export is unique and carries iPhone 15 Pro metadata.',
                'Your files land in your private thread under this channel.',
            ].join('\n')
        );
}

function panelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(IDS.open).setLabel('Create Content').setEmoji('✨').setStyle(ButtonStyle.Success)
        ),
    ];
}

function pickerComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(IDS.video).setLabel('Video').setEmoji('🎬').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(IDS.carousel).setLabel('Carousel').setEmoji('🖼️').setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(IDS.batchVideo).setLabel('Batch videos').setEmoji('📦').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(IDS.batchCarousel).setLabel('Batch carousels').setEmoji('📦').setStyle(ButtonStyle.Secondary)
        ),
    ];
}

function batchModal(kind) {
    return new ModalBuilder()
        .setCustomId(`${IDS.modalPrefix}${kind}`)
        .setTitle(kind === 'video' ? 'Batch videos' : 'Batch carousels')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(IDS.countInput)
                    .setLabel(`How many? (max ${MAX_BATCH})`)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('3')
                    .setValue('3')
                    .setMinLength(1)
                    .setMaxLength(1)
                    .setRequired(true)
            )
        );
}

function progressEmbed(kind, current, total) {
    return new EmbedBuilder()
        .setColor(PROGRESS_COLOR)
        .setDescription(`⏳ **Generating ${KIND_LABEL[kind]} ${current}/${total}...**`);
}

/** Post the panel once; on restart, edit the existing panel instead of re-posting it. */
async function publishContentPanel(client) {
    let channel;
    try {
        channel = await client.channels.fetch(PANEL_CHANNEL_ID);
    } catch (error) {
        console.warn(`[CONTENT-PANEL] Channel ${PANEL_CHANNEL_ID} not reachable:`, error?.message || error);
        return;
    }
    if (!channel?.isTextBased?.()) {
        console.warn(`[CONTENT-PANEL] Channel ${PANEL_CHANNEL_ID} is not a text channel.`);
        return;
    }

    const payload = { embeds: [panelEmbed()], components: panelComponents() };
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const panels = recent
        ? [...recent.values()].filter(
              (message) =>
                  message.author.id === client.user.id &&
                  message.components.some((row) => row.components.some((c) => c.customId === IDS.open))
          )
        : [];

    if (panels.length) {
        const [latest, ...duplicates] = panels;
        await latest.edit(payload);
        for (const duplicate of duplicates) await duplicate.delete().catch(() => {});
        console.log(`[CONTENT-PANEL] Panel updated in #${channel.name}`);
    } else {
        await channel.send(payload);
        console.log(`[CONTENT-PANEL] Panel posted in #${channel.name}`);
    }
}

function threadNameFor(user) {
    const cleaned = String(user.username || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
    return `content-${cleaned || 'user'}`.slice(0, 90);
}

async function findUserThread(channel, user) {
    const name = threadNameFor(user);
    const active = await channel.threads.fetchActive().catch(() => null);
    const live = active?.threads.find((thread) => thread.name === name && thread.parentId === channel.id);
    if (live) return live;
    const archived = await channel.threads.fetchArchived({ type: 'private', fetchAll: true }).catch(() => null);
    const old = archived?.threads.find((thread) => thread.name === name);
    if (old) {
        await old.setArchived(false).catch(() => {});
        await old.members.add(user.id).catch(() => {});
        return old;
    }
    return null;
}

/** Private thread per user; falls back to the channel itself if the bot cannot create threads. */
async function getDeliveryTarget(channel, member) {
    try {
        const existing = await findUserThread(channel, member.user);
        if (existing) return existing;
        const thread = await channel.threads.create({
            name: threadNameFor(member.user),
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: 10080,
            reason: `Content workspace for ${member.user.tag}`,
        });
        await thread.members.add(member.id);
        await thread.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(PANEL_COLOR)
                    .setTitle('🎬 Your content workspace')
                    .setDescription(
                        `Hey ${member} — your generated videos and carousels will appear here.\n` +
                            'Download carousel ZIPs to keep the iPhone metadata (Discord previews strip it).'
                    ),
            ],
        });
        return thread;
    } catch (error) {
        console.warn('[CONTENT-PANEL] Private thread unavailable, posting in channel:', error?.message || error);
        return channel;
    }
}

async function startJob(interaction, kind, count) {
    if (!isStaff(interaction)) {
        await interaction.reply({ content: 'Content generation is reserved for staff.', flags: MessageFlags.Ephemeral });
        return;
    }
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: 'Use the panel in a text channel.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = await getDeliveryTarget(channel, interaction.member);

    const { position, run } = enqueue(async () => {
        const jobDir = makeJobDir();
        try {
            await interaction.editReply({ content: '', embeds: [progressEmbed(kind, 1, count)] }).catch(() => {});
            const args =
                kind === 'video'
                    ? ['video', '--count', String(count), '--out', jobDir, '--max-mb', String(uploadLimitMb(interaction.guild))]
                    : ['carousel', '--count', String(count), '--out', jobDir];
            const result = await runEngine(args, (current, total) =>
                interaction.editReply({ embeds: [progressEmbed(kind, current, total)] })
            );

            const done = (result.items || []).length;
            const send = (payload) => target.send(payload);
            if (kind === 'video') await deliverVideos(send, result, `${interaction.user} `);
            else await deliverCarousels(send, result, `${interaction.user} `);

            const plural = count > 1 ? 's' : '';
            const embed = new EmbedBuilder()
                .setColor(done ? DONE_COLOR : 0xed4245)
                .setDescription(
                    [
                        done
                            ? `✅ **Complete — ${done}/${count} ${KIND_LABEL[kind]}${plural}**\nPosted in ${target}`
                            : `❌ **Generation failed**`,
                        errorLines(result),
                    ]
                        .filter(Boolean)
                        .join('\n')
                );
            await interaction.editReply({ content: '', embeds: [embed] }).catch(() => {});
        } catch (error) {
            console.error(`[CONTENT-PANEL] ${kind} job failed:`, error);
            await interaction
                .editReply({ content: `❌ Generation failed: ${error?.message || 'unknown error'}`, embeds: [] })
                .catch(() => {});
        } finally {
            removeDir(jobDir);
        }
    });

    if (position > 1) {
        await interaction.editReply(`🕒 Queued (position ${position}). Another render is running…`).catch(() => {});
    }
    await run;
}

/** Returns true when the interaction belonged to the panel. */
async function handlePanelInteraction(interaction) {
    if (interaction.isButton()) {
        switch (interaction.customId) {
            case IDS.open:
                if (!isStaff(interaction)) {
                    await interaction.reply({ content: 'Content generation is reserved for staff.', flags: MessageFlags.Ephemeral });
                    return true;
                }
                await interaction.reply({
                    content: '**What do you want to create?**',
                    components: pickerComponents(),
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            case IDS.video:
                await startJob(interaction, 'video', 1);
                return true;
            case IDS.carousel:
                await startJob(interaction, 'carousel', 1);
                return true;
            case IDS.batchVideo:
                await interaction.showModal(batchModal('video'));
                return true;
            case IDS.batchCarousel:
                await interaction.showModal(batchModal('carousel'));
                return true;
            default:
                return false;
        }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(IDS.modalPrefix)) {
        const kind = interaction.customId.slice(IDS.modalPrefix.length) === 'carousel' ? 'carousel' : 'video';
        const raw = interaction.fields.getTextInputValue(IDS.countInput).trim();
        const count = Number(raw);
        if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
            await interaction.reply({ content: `Enter a whole number between 1 and ${MAX_BATCH}.`, flags: MessageFlags.Ephemeral });
            return true;
        }
        await startJob(interaction, kind, count);
        return true;
    }

    return false;
}

module.exports = { handlePanelInteraction, publishContentPanel };
