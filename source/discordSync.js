/** True when a posted message already shows the payload, so a restart doesn't need to touch it. */
function sameMessage(message, payload) {
    const json = (item) => (item?.toJSON ? item.toJSON() : item);
    const embedKey = (e) => {
        const { title = '', description = '', fields = [], footer } = json(e);
        return JSON.stringify([title, description, fields.map((f) => [f.name, f.value]), footer?.text || '']);
    };
    const componentKey = (rows) =>
        rows.flatMap((row) => json(row).components.map((c) => [c.custom_id || c.url || '', c.label || ''].join('|'))).join();

    const want = payload.embeds || [];
    return (
        (payload.content ?? '') === (message.content ?? '') &&
        want.length === message.embeds.length &&
        want.every((e, i) => embedKey(e) === embedKey(message.embeds[i])) &&
        componentKey(payload.components || []) === componentKey(message.components)
    );
}

/**
 * Creator-program channels (start-here, warmup, dm-automation, payouts, ...) only live in the
 * "Ecom Efficiency Post" server. The bot is also in the main Ecom Efficiency server and must never
 * post or create creator channels there.
 */
const CREATOR_GUILD_ID = process.env.CREATOR_GUILD_ID || '1556164962530103387';

function creatorGuilds(client) {
    return [...client.guilds.cache.values()].filter((guild) => guild.id === CREATOR_GUILD_ID);
}

module.exports = { sameMessage, creatorGuilds, CREATOR_GUILD_ID };
