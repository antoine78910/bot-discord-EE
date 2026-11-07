/**
 * AdsPower "Get the code" panel for the EE content bot (contentBot.js).
 * Code comes from the EE website (which holds ADSPOWER_TOTP_BY_EMAIL_JSON):
 *   EE_ADSPOWER_OTP_API_URL (default https://app.ecomefficiency.com/api/adspower/otp/discord)
 *   EE_DISCORD_OTP_SECRET   (Bearer, same value as Vercel)
 * Optional local fallback: DISCORD_ADSPOWER_AUTHENTICATOR_SECRET (Base32, otplib).
 */
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');

const ADSPOWER_TOTP_BUTTON_ID = 'ee_adspower_get_totp';
const PANEL_CONTENT = 'Click to get your Adspower verification code';
const TOTP_PERIOD_SEC = 30;

const channelId = () => String(process.env.DISCORD_ADSPOWER_OTP_CHANNEL_ID || '1262357372970467451').trim();
const apiUrl = () =>
    String(process.env.EE_ADSPOWER_OTP_API_URL || 'https://app.ecomefficiency.com/api/adspower/otp/discord').trim();
const apiSecret = () => String(process.env.EE_DISCORD_OTP_SECRET || '').trim();
const localSecret = () => String(process.env.DISCORD_ADSPOWER_AUTHENTICATOR_SECRET || '').trim().replace(/\s/g, '');

function messageHasAdspowerOtpButton(message) {
    try {
        for (const row of message?.components || []) {
            const comps = row?.components || row?.data?.components || [];
            for (const c of comps) {
                const id = c?.customId ?? c?.data?.custom_id;
                const type = c?.type ?? c?.data?.type;
                if (type === ComponentType.Button && id === ADSPOWER_TOTP_BUTTON_ID) return true;
            }
        }
    } catch {}
    return false;
}

async function ensureAdspowerOtpPanel(client) {
    const id = channelId();
    if (!id) return;
    try {
        const ch = await client.channels.fetch(id).catch(() => null);
        if (!ch || !ch.isTextBased()) {
            console.warn('[ADSPOWER] OTP channel not found or not text-based:', id);
            return;
        }
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(ADSPOWER_TOTP_BUTTON_ID).setLabel('Get the code').setStyle(ButtonStyle.Primary)
        );
        const recent = await ch.messages.fetch({ limit: 50 }).catch(() => null);
        // Only consider messages posted by THIS bot; never touch other apps' messages.
        const mine = recent
            ? [...recent.values()].filter((m) => m.author?.id === client.user.id && messageHasAdspowerOtpButton(m))
            : [];
        // Repost on every startup so the panel is always the newest message in the channel.
        for (const m of mine) await m.delete().catch(() => {});
        if (mine.length) console.log(`[ADSPOWER] Removed ${mine.length} old OTP panel(s)`);
        const sent = await ch.send({ content: PANEL_CONTENT, components: [row] });
        console.log(`[ADSPOWER] OTP panel posted in channel ${id} (message ${sent.id})`);
    } catch (e) {
        console.warn('[ADSPOWER] ensureAdspowerOtpPanel failed:', e?.message || e);
    }
}

async function fetchCodeFromApi() {
    const url = new URL(apiUrl());
    url.searchParams.set('plan', 'pro');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiSecret()}`, Accept: 'application/json' },
            signal: ctrl.signal,
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok || !j.code) {
            const err = new Error(`otp_api_${r.status}_${j?.error || 'bad_response'}`);
            err.notConfigured = r.status === 404 || r.status === 401;
            throw err;
        }
        return { code: String(j.code), validUntilUnix: Number(j.validUntilUnix) || 0 };
    } finally {
        clearTimeout(timer);
    }
}

function generateLocal(secret) {
    const { generateSync } = require('otplib');
    const epoch = Math.floor(Date.now() / 1000);
    const mod = epoch % TOTP_PERIOD_SEC;
    const left = mod === 0 ? TOTP_PERIOD_SEC : TOTP_PERIOD_SEC - mod;
    const code = generateSync({ secret, strategy: 'totp', period: TOTP_PERIOD_SEC });
    return { code, validUntilUnix: epoch + left };
}

async function handleAdspowerOtpInteraction(interaction) {
    if (!interaction.isButton() || interaction.customId !== ADSPOWER_TOTP_BUTTON_ID) return false;
    const hasApi = Boolean(apiUrl() && apiSecret());
    const local = localSecret();
    if (!hasApi && !local) {
        await interaction.reply({
            content: 'The AdsPower code is not configured yet. Please contact the staff.',
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        let payload;
        if (hasApi) {
            try {
                payload = await fetchCodeFromApi();
            } catch (e) {
                if (!local) throw e;
                console.warn('[ADSPOWER] API failed, using local fallback:', e?.message || e);
            }
        }
        if (!payload) payload = generateLocal(local);
        const left = Math.max(0, payload.validUntilUnix - Math.floor(Date.now() / 1000));
        await interaction.editReply({
            content: `**Current code:** \`${payload.code}\`\n**Time left:** ${left}s (then tap the button again).`,
        });
        console.log(`[ADSPOWER] code delivered to ${interaction.user?.id}`);
    } catch (e) {
        console.warn('[ADSPOWER] handleAdspowerOtpInteraction:', e?.message || e);
        const content = e?.notConfigured
            ? 'The AdsPower code is not configured yet. Please contact the staff.'
            : 'Could not generate the code. Try again in a moment.';
        try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch {}
    }
    return true;
}

module.exports = { ADSPOWER_TOTP_BUTTON_ID, ensureAdspowerOtpPanel, handleAdspowerOtpInteraction };
