/**
 * Payout submission (port of the YouRy bot's payout_submission.py).
 * Panel with a "Submit Payout" button -> private payout-<user> channel,
 * with "Mark Paid & Close" (DMs the creator) and "Close Ticket" buttons.
 *
 * A ticket is visible only to the creator who opened it, the bot, the server owner and
 * CONTENT_REVIEWER_ID / OWNER_USER_ID (Discord administrators always see every channel).
 * Open tickets are re-locked to that list on every start.
 *
 * Env:
 *   PAYOUT_SUBMISSION_CHANNEL_ID   panel channel (default: first channel whose name contains "payout-submission")
 *   PAYOUT_TICKET_CATEGORY_ID      category for tickets (default: the panel channel's category)
 *   STAFF_ROLE_ID / CONTENT_STAFF_ROLE_IDS   roles allowed to click Submit Payout without the creator role
 *   CONTENT_REVIEWER_ID / OWNER_USER_ID      user pinged and given access in tickets
 */
const crypto = require('crypto');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    OverwriteType,
    PermissionFlagsBits,
} = require('discord.js');
const { sameMessage } = require('./discordSync');

const EMBED_COLOR = 0x8b5cf6;
const IDS = {
    submit: 'ee_payout_submit',
    paid: 'ee_payout_mark_paid',
    close: 'ee_payout_close',
};

const CREATOR_ROLE_ID = process.env.CREATOR_ROLE_ID || '1560108191142903868';
const APPLY_CHANNEL_ID = process.env.CREATOR_APPLY_CHANNEL_ID || '1556165097984892928';
const NOT_ALLOWED = `🚀 You need to register first to submit a payout. Go to <#${APPLY_CHANNEL_ID}>, click **Register**, then come back here.`;
const PANEL_CHANNEL_ID = process.env.PAYOUT_SUBMISSION_CHANNEL_ID || '';
const TICKET_CATEGORY_ID = process.env.PAYOUT_TICKET_CATEGORY_ID || '';
const REVIEWER_ID = process.env.CONTENT_REVIEWER_ID || process.env.OWNER_USER_ID || '';
const OWNER_IDS = [process.env.CONTENT_REVIEWER_ID, process.env.OWNER_USER_ID]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
const STAFF_ROLE_IDS = [
    process.env.STAFF_ROLE_ID,
    process.env.TICKET_STAFF_ROLE_ID,
    ...String(process.env.CONTENT_STAFF_ROLE_IDS || '').split(','),
]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

function submissionEmbed() {
    return new EmbedBuilder()
        .setTitle('💰 Payout Submission')
        .setColor(EMBED_COLOR)
        .setDescription(
            'Submit your account analytics by clicking the button below.\n\n' +
                'A private ticket channel will open just between you and the admins. ' +
                'Drop your view counts, video links, and screenshots there — ' +
                'payouts process within 48 hours.'
        );
}

function ticketEmbed(user, ticketId) {
    return new EmbedBuilder()
        .setTitle('💸 Payout Submission')
        .setColor(EMBED_COLOR)
        .setDescription(
            `Hey ${user} — welcome to your payout ticket.\n\n` +
                '**Please reply in this channel with:**\n' +
                '1. Your Instagram / TikTok handle (UGC account)\n' +
                '2. Period covered (e.g. Oct 1–15, 2026)\n' +
                '3. Total views generated across all posts\n' +
                '4. Screen recording of your account analytics\n\n' +
                "We'll verify and process within **48 hours**. " +
                "You'll get a DM the moment your payout is sent."
        )
        .setFooter({ text: `Ticket ID: ${ticketId}` });
}

function submitRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.submit).setLabel('Submit Payout').setEmoji('💸').setStyle(ButtonStyle.Success)
    );
}

function ticketRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.paid).setLabel('Mark Paid & Close').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(IDS.close).setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
    );
}

function ticketName(user) {
    const cleaned = String(user.username || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `payout-${(cleaned || 'user').slice(0, 32)}`;
}

/** The opener is the only member with an explicit view overwrite besides the bot and the owners. */
function ticketOpenerId(channel) {
    const others = new Set([channel.client.user.id, channel.guild.ownerId, ...OWNER_IDS]);
    const overwrite = channel.permissionOverwrites.cache.find(
        (entry) => entry.type === 1 && !others.has(entry.id) && entry.allow.has(PermissionFlagsBits.ViewChannel)
    );
    return overwrite?.id || null;
}

function isTicketChannel(channel) {
    return channel?.type === ChannelType.GuildText && channel.name.startsWith('payout-') && !channel.name.includes('submission');
}

async function findPanelChannel(guild) {
    if (PANEL_CHANNEL_ID) {
        const channel = await guild.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
        return channel?.guildId === guild.id ? channel : null;
    }
    const channels = await guild.channels.fetch().catch(() => null);
    return channels?.find((c) => c?.type === ChannelType.GuildText && c.name.includes('payout-submission')) || null;
}

/** Post the panel once per guild; on restart, edit the existing panel instead of re-posting it. */
async function publishPayoutPanel(client) {
    for (const guild of client.guilds.cache.values()) {
        const channel = await findPanelChannel(guild);
        if (!channel) {
            console.warn(`[PAYOUT] No payout-submission channel in ${guild.name} (set PAYOUT_SUBMISSION_CHANNEL_ID).`);
            continue;
        }
        const payload = { embeds: [submissionEmbed()], components: [submitRow()] };
        const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        const panels = recent
            ? [...recent.values()].filter(
                  (m) => m.author.id === client.user.id && m.components.some((row) => row.components.some((c) => c.customId === IDS.submit))
              )
            : [];
        try {
            if (panels.length) {
                const [latest, ...duplicates] = panels;
                for (const duplicate of duplicates) await duplicate.delete().catch(() => {});
                if (sameMessage(latest, payload)) {
                    console.log(`[PAYOUT] Panel unchanged in #${channel.name}`);
                } else {
                    await latest.edit(payload);
                    console.log(`[PAYOUT] Panel updated in #${channel.name}`);
                }
            } else {
                await channel.send(payload);
                console.log(`[PAYOUT] Panel posted in #${channel.name}`);
            }
        } catch (error) {
            console.warn(`[PAYOUT] Could not publish panel in #${channel.name}:`, error?.message || error);
        }
        await lockOpenTickets(guild).catch((error) => console.warn('[PAYOUT] Ticket lock failed:', error?.message || error));
    }
}

/** Only the opener, the bot and the owners: no role gets access, so @everyone/staff/creators can't see it. */
async function ticketOverwrites(guild, openerId) {
    const access = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
    ];
    const me = guild.members.me || (await guild.members.fetchMe());
    const overwrites = [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: me.id,
            type: OverwriteType.Member,
            allow: [...access, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
        },
    ];
    if (openerId && openerId !== me.id) overwrites.push({ id: openerId, type: OverwriteType.Member, allow: access });
    for (const ownerId of new Set([guild.ownerId, ...OWNER_IDS])) {
        if (!ownerId || ownerId === openerId || ownerId === me.id) continue;
        overwrites.push({ id: ownerId, type: OverwriteType.Member, allow: [...access, PermissionFlagsBits.ManageMessages] });
    }
    return overwrites;
}

/** Re-apply the private overwrites to every open payout ticket (fixes tickets opened with staff-role access). */
async function lockOpenTickets(guild) {
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    let locked = 0;
    for (const channel of [...channels.values()]) {
        if (!isTicketChannel(channel)) continue;
        const openerId = ticketOpenerId(channel);
        const roles = channel.permissionOverwrites.cache
            .filter((entry) => entry.type === 0 && entry.id !== guild.id && entry.allow.has(PermissionFlagsBits.ViewChannel))
            .map((entry) => guild.roles.cache.get(entry.id)?.name || entry.id);
        try {
            await channel.permissionOverwrites.set(await ticketOverwrites(guild, openerId), 'Payout tickets are private');
            locked += 1;
            if (roles.length || !openerId) {
                console.log(
                    `[PAYOUT] Locked #${channel.name}: removed role access [${roles.join(', ') || 'none'}]${openerId ? '' : ' · opener unknown'}`
                );
            }
        } catch (error) {
            console.warn(`[PAYOUT] Could not lock #${channel.name}:`, error?.message || error);
        }
    }
    console.log(`[PAYOUT] ${locked} open ticket(s) private in ${guild.name}`);
}

function canSubmit(member) {
    if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
    const roles = member.roles?.cache ? [...member.roles.cache.keys()] : Array.isArray(member.roles) ? member.roles : [];
    return roles.includes(CREATOR_ROLE_ID) || roles.some((roleId) => STAFF_ROLE_IDS.includes(roleId));
}

async function openTicket(interaction) {
    const { guild, member } = interaction;
    if (!guild || !member) {
        await interaction.reply({ content: 'This button only works in a server.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!canSubmit(member)) {
        await interaction.reply({ content: NOT_ALLOWED, flags: MessageFlags.Ephemeral });
        return;
    }

    const name = ticketName(member.user);
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const existing = channels.find(
        (c) => c?.type === ChannelType.GuildText && c.name === name && c.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
    );
    if (existing) {
        await interaction.reply({ content: `✅ Your payout ticket is ready: ${existing}`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let ticket;
    try {
        const parent = TICKET_CATEGORY_ID || interaction.channel?.parentId || null;
        ticket = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            parent,
            permissionOverwrites: await ticketOverwrites(guild, member.id),
            reason: `Payout ticket for ${member.user.tag}`,
        });
    } catch (error) {
        await interaction.editReply(`Could not create your ticket: ${error?.message || 'unknown error'}`);
        return;
    }

    const ping = REVIEWER_ID && REVIEWER_ID !== member.id ? `<@${REVIEWER_ID}>` : '';
    await ticket.send({
        content: ping || undefined,
        embeds: [ticketEmbed(member, crypto.randomUUID())],
        components: [ticketRow()],
        allowedMentions: { users: ping ? [REVIEWER_ID] : [] },
    });
    await interaction.editReply(`✅ Your payout ticket is ready: ${ticket}`);
}

async function closeTicket(interaction, paid) {
    const channel = interaction.channel;
    if (!isTicketChannel(channel)) return;
    if (!channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.ViewChannel)) {
        await interaction.reply({ content: "You don't have permission to manage this ticket.", flags: MessageFlags.Ephemeral });
        return;
    }
    const isOwner =
        interaction.user.id === interaction.guild.ownerId ||
        OWNER_IDS.includes(interaction.user.id) ||
        interaction.member.permissions?.has?.(PermissionFlagsBits.Administrator);
    if (paid && !isOwner) {
        await interaction.reply({ content: 'Only the admin can mark a payout as paid.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (paid) {
        const openerId = ticketOpenerId(channel);
        const opener = openerId ? await interaction.client.users.fetch(openerId).catch(() => null) : null;
        await opener
            ?.send('✅ Your payout has been processed and sent. Thanks for posting with **Ecom Efficiency**!')
            .catch(() => {});
    }
    await interaction.reply({ content: paid ? 'Ticket marked as paid. Closing…' : 'Closing ticket…', flags: MessageFlags.Ephemeral });
    await channel.delete(`${paid ? 'Paid & closed' : 'Closed'} by ${interaction.user.tag}`).catch(() => {});
}

/** Returns true when the interaction belonged to the payout flow. */
async function handlePayoutInteraction(interaction) {
    if (!interaction.isButton()) return false;
    if (interaction.customId === IDS.submit) {
        await openTicket(interaction);
        return true;
    }
    if (interaction.customId === IDS.paid || interaction.customId === IDS.close) {
        await closeTicket(interaction, interaction.customId === IDS.paid);
        return true;
    }
    return false;
}

module.exports = { handlePayoutInteraction, publishPayoutPanel };
