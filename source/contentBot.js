/**
 * Dedicated EE content bot (separate Discord application from the ticket bot).
 * Runs only /ee-content, registered on every server the bot is in.
 * Start with `node contentBot.js` (Railway: own service with BOT_ENTRY=contentBot.js).
 *
 * Env: CONTENT_BOT_TOKEN (required), STAFF_ROLE_ID / CONTENT_STAFF_ROLE_IDS, PYTHON_BIN, FFMPEG_PATH.
 */
const fs = require('fs');
const path = require('path');
const { Client, Events, GatewayIntentBits } = require('discord.js');

try {
    const dotenv = require('dotenv');
    for (const candidate of [
        path.resolve(__dirname, '.env.local'),
        path.resolve(__dirname, '.env'),
        path.resolve(__dirname, '..', '.env.local'),
        path.resolve(__dirname, '..', '.env'),
    ]) {
        if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
    }
} catch {}

const { CONTENT_COMMAND, getContentSlashCommand, handleContentCommand } = require('./contentStudio');

const TOKEN = process.env.CONTENT_BOT_TOKEN;

if (!TOKEN) {
    console.error('[CONTENT-BOT] CONTENT_BOT_TOKEN is missing.');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
    const command = getContentSlashCommand().toJSON();
    const joined = [...client.guilds.cache.values()];
    console.log(`[CONTENT-BOT] In ${joined.length} server(s): ${joined.map((g) => `${g.name} (${g.id})`).join(', ') || 'none'}`);
    for (const guildId of joined.map((g) => g.id)) {
        try {
            const guild = await client.guilds.fetch(guildId);
            await guild.commands.set([command]);
            console.log(`[CONTENT-BOT] /${CONTENT_COMMAND} registered on ${guild.name}`);
        } catch (error) {
            console.warn(`[CONTENT-BOT] Could not register on guild ${guildId}:`, error?.message || error);
        }
    }
}

client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[CONTENT-BOT] Logged in as ${readyClient.user.tag}`);
    await registerCommands();
});

client.on(Events.GuildCreate, () => {
    registerCommands().catch(() => {});
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== CONTENT_COMMAND) return;
    try {
        await handleContentCommand(interaction);
    } catch (error) {
        console.error('[CONTENT-BOT] interaction error:', error);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply('Something went wrong.');
            } else {
                await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
            }
        } catch {}
    }
});

process.on('unhandledRejection', (error) => {
    console.error('[CONTENT-BOT] unhandled rejection:', error);
});

client.login(TOKEN);
