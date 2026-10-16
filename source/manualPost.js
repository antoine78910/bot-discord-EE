/**
 * Staff-only manual posting as the bot:
 *   /post-proof   post up to 10 uploaded payment proofs in slot order, or the next one from the folder
 *                 (restarts the 2-day countdown)
 *   /say          post a message and/or an image in any text channel
 */
const { AttachmentBuilder, ChannelType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaff } = require('./contentStudio');
const { postNextProof, postProofImage } = require('./paymentProofs');

const POST_PROOF_COMMAND = 'post-proof';
const SAY_COMMAND = 'say';
const PROOF_SLOTS = Array.from({ length: 10 }, (_, i) => `image${i + 1}`);

function getManualPostCommands() {
    return [
        PROOF_SLOTS.reduce(
            (command, slot) =>
                command.addAttachmentOption((option) =>
                    option.setName(slot).setDescription(`Payment proof #${slot.slice(5)} (posted in this order)`)
                ),
            new SlashCommandBuilder()
                .setName(POST_PROOF_COMMAND)
                .setDescription('Staff: post payment proofs now (upload up to 10, or the next from the folder).')
        ),
        new SlashCommandBuilder()
            .setName(SAY_COMMAND)
            .setDescription('Staff: send a message as the bot.')
            .addChannelOption((option) =>
                option
                    .setName('channel')
                    .setDescription('Where to post')
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                    .setRequired(true)
            )
            .addStringOption((option) =>
                option.setName('message').setDescription('Text (use \\n for a new line)').setMaxLength(2000)
            )
            .addAttachmentOption((option) => option.setName('image').setDescription('Image or file to attach')),
    ];
}

async function handlePostProof(interaction) {
    const uploads = PROOF_SLOTS.map((slot) => interaction.options.getAttachment(slot)).filter(Boolean);
    if (uploads.some((upload) => !String(upload.contentType || '').startsWith('image/'))) {
        await interaction.reply({ content: 'Upload images only (PNG, JPG or WebP).', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (uploads.length) {
        let channel = null;
        for (const upload of uploads) channel = await postProofImage(interaction.client, upload.url, upload.name);
        await interaction.editReply(`✅ ${uploads.length} payment proof(s) posted in ${channel}, in order.`);
        return;
    }
    const result = await postNextProof(interaction.client, { force: true });
    await interaction.editReply(
        result
            ? `✅ Posted \`${result.name}\` in ${result.channel}. ${result.remaining} left, next one automatically in 2 days.`
            : 'Nothing to post: every payment proof in the folder has already been posted.'
    );
}

async function handleSay(interaction) {
    const channel = interaction.options.getChannel('channel', true);
    const text = (interaction.options.getString('message') || '').replace(/\\n/g, '\n');
    const attachment = interaction.options.getAttachment('image');
    if (!text && !attachment) {
        await interaction.reply({ content: 'Add a message, an image, or both.', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = await interaction.client.channels.fetch(channel.id);
    await target.send({
        content: text || undefined,
        files: attachment ? [new AttachmentBuilder(attachment.url, { name: attachment.name })] : [],
    });
    await interaction.editReply(`✅ Sent in ${target}.`);
}

/** Returns true when the interaction was one of these commands. */
async function handleManualPostCommand(interaction) {
    if (!interaction.isChatInputCommand()) return false;
    if (![POST_PROOF_COMMAND, SAY_COMMAND].includes(interaction.commandName)) return false;
    if (!isStaff(interaction)) {
        await interaction.reply({ content: 'This command is reserved for staff.', flags: MessageFlags.Ephemeral });
        return true;
    }
    if (interaction.commandName === POST_PROOF_COMMAND) await handlePostProof(interaction);
    else await handleSay(interaction);
    return true;
}

module.exports = { getManualPostCommands, handleManualPostCommand };
