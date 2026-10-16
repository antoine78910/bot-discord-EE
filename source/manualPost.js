/**
 * Staff-only manual posting as the bot:
 *   /post-proof   post an uploaded payment proof, or the next one from the folder (restarts the 2-day countdown)
 *   /say          post a message and/or an image in any text channel
 */
const { AttachmentBuilder, ChannelType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isStaff } = require('./contentStudio');
const { postNextProof, postProofImage } = require('./paymentProofs');

const POST_PROOF_COMMAND = 'post-proof';
const SAY_COMMAND = 'say';

function getManualPostCommands() {
    return [
        new SlashCommandBuilder()
            .setName(POST_PROOF_COMMAND)
            .setDescription('Staff: post a payment proof now (upload one, or the next from the folder).')
            .addAttachmentOption((option) =>
                option.setName('image').setDescription('Payment proof screenshot to post')
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
    const upload = interaction.options.getAttachment('image');
    if (upload && !String(upload.contentType || '').startsWith('image/')) {
        await interaction.reply({ content: 'Upload an image (PNG, JPG or WebP).', flags: MessageFlags.Ephemeral });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (upload) {
        const channel = await postProofImage(interaction.client, upload.url, upload.name);
        await interaction.editReply(`✅ Payment proof posted in ${channel}.`);
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
