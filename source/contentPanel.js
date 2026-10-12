/**
 * "Generate Content" panel (YouRy-style) for the EE content bot.
 * Panel button -> ephemeral picker (Variator / YouRy clip / Carousel + quantity)
 * -> render queue -> private thread per user.
 */
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
} = require('discord.js');
const {
    MAX_ITEMS,
    deliverCarousels,
    deliverVideos,
    enqueue,
    errorLines,
    isStaff,
    makeJobDir,
    removeDir,
    runEngine,
    videoArgs,
} = require('./contentStudio');

const PANEL_CHANNEL_ID = process.env.CONTENT_PANEL_CHANNEL_ID || '1556165419184816219';
const PANEL_COLOR = 0x8b5cf6;
const PROGRESS_COLOR = 0x5865f2;
const DONE_COLOR = 0x57f287;

const IDS = {
    open: 'ee_content_open',
    quantity: 'ee_content_qty',
    makePrefix: 'ee_content_make:',
};

const KINDS = {
    variator: { label: 'Variator video', button: 'Variator', emoji: '🎞️', style: ButtonStyle.Success },
    youry: { label: 'YouRy clip', button: 'YouRy clip', emoji: '✂️', style: ButtonStyle.Primary },
    carousel: { label: 'carousel', button: 'Carousel', emoji: '🖼️', style: ButtonStyle.Secondary },
};

function panelEmbed() {
    return new EmbedBuilder()
        .setTitle('🎬 Content Generator')
        .setColor(PANEL_COLOR)
        .setDescription(
            [
                'Click **Generate Content**, then choose what to create:',
                '',
                '🎞️ **Variator**: caption banner + template with the app steps + trending sound',
                '✂️ **YouRy clip**: hook + body + music + text hook, random variations',
                '🖼️ **Carousel**: 5 slides (avatar hook, 3 tools, Ecom Efficiency recap) + ZIP',
                '',
                'Pick 1 to 5 at once. Every export is unique and carries iPhone 15 Pro metadata.',
                'Your files land in your private thread under this channel.',
            ].join('\n')
        );
}

function panelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(IDS.open).setLabel('Generate Content').setEmoji('🎬').setStyle(ButtonStyle.Success)
        ),
    ];
}

function pickerComponents(quantity) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(IDS.quantity)
        .setPlaceholder('How many?')
        .addOptions(
            Array.from({ length: MAX_ITEMS }, (_, i) => ({
                label: `${i + 1} at once`,
                value: String(i + 1),
                default: i + 1 === quantity,
            }))
        );
    const buttons = Object.entries(KINDS).map(([kind, meta]) =>
        new ButtonBuilder()
            .setCustomId(`${IDS.makePrefix}${kind}:${quantity}`)
            .setLabel(quantity > 1 ? `${meta.button} ×${quantity}` : meta.button)
            .setEmoji(meta.emoji)
            .setStyle(meta.style)
    );
    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(...buttons)];
}

function progressEmbed(kind, current, total) {
    return new EmbedBuilder()
        .setColor(PROGRESS_COLOR)
        .setDescription(`⏳ **Generating ${KINDS[kind].label} ${current}/${total}...**`);
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
                        `Hey ${member} — your Variator videos, YouRy clips and carousels will appear here.\n` +
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
    const label = KINDS[kind].label;

    const { position, run } = enqueue(async () => {
        const jobDir = makeJobDir();
        try {
            await interaction.editReply({ content: '', embeds: [progressEmbed(kind, 1, count)] }).catch(() => {});
            const args =
                kind === 'carousel'
                    ? ['carousel', '--count', String(count), '--out', jobDir]
                    : videoArgs(kind, count, jobDir, interaction.guild);
            const result = await runEngine(args, (current, total) =>
                interaction.editReply({ embeds: [progressEmbed(kind, current, total)] })
            );

            const done = (result.items || []).length;
            const send = (payload) => target.send(payload);
            if (kind === 'carousel') await deliverCarousels(send, result, `${interaction.user} `);
            else await deliverVideos(send, result, `${interaction.user} `);

            const plural = count > 1 ? 's' : '';
            const embed = new EmbedBuilder()
                .setColor(done ? DONE_COLOR : 0xed4245)
                .setDescription(
                    [
                        done ? `✅ **Complete — ${done}/${count} ${label}${plural}**\nPosted in ${target}` : '❌ **Generation failed**',
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
    if (interaction.isButton() && interaction.customId === IDS.open) {
        if (!isStaff(interaction)) {
            await interaction.reply({ content: 'Content generation is reserved for staff.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({
            content: '**What do you want to generate?** Pick a quantity, then a type.',
            components: pickerComponents(1),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === IDS.quantity) {
        const quantity = Math.max(1, Math.min(MAX_ITEMS, Number(interaction.values[0]) || 1));
        await interaction.update({ components: pickerComponents(quantity) });
        return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(IDS.makePrefix)) {
        const [kind, rawCount] = interaction.customId.slice(IDS.makePrefix.length).split(':');
        if (!KINDS[kind]) return false;
        const count = Math.max(1, Math.min(MAX_ITEMS, Number(rawCount) || 1));
        await startJob(interaction, kind, count);
        return true;
    }

    return false;
}

module.exports = { handlePanelInteraction, publishContentPanel };
