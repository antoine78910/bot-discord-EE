/**
 * Drip-posts payment proof screenshots: one new image every 2 days, in file-name order,
 * from content_engine/workflow/payment proofs. Each image is posted once; images added
 * later are picked up automatically.
 *
 * Env:
 *   PAYMENT_PROOF_CHANNEL_ID   target channel (default: 1556165115244449822)
 *   PAYMENT_PROOF_INTERVAL_HOURS   hours between posts (default: 48)
 */
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const CHANNEL_ID = process.env.PAYMENT_PROOF_CHANNEL_ID || '1556165115244449822';
const INTERVAL_MS = Number(process.env.PAYMENT_PROOF_INTERVAL_HOURS || 48) * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const PROOFS_DIR = path.join(__dirname, 'content_engine', 'workflow', 'payment proofs');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
// /data is the Railway volume; the container filesystem is wiped on every deploy.
const STATE_PATH =
    process.env.PAYMENT_PROOF_STATE_PATH ||
    (fs.existsSync('/data') ? '/data/payment-proofs.json' : path.join(__dirname, 'data', 'payment-proofs.json'));

function loadState() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        return { posted: Array.isArray(raw.posted) ? raw.posted : [], lastPostedAt: Number(raw.lastPostedAt) || 0 };
    } catch {
        return { posted: [], lastPostedAt: 0 };
    }
}

function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function listProofs() {
    if (!fs.existsSync(PROOFS_DIR)) return [];
    return fs
        .readdirSync(PROOFS_DIR)
        .filter((name) => IMAGE_EXT.has(path.extname(name).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

async function postNextProof(client) {
    const state = loadState();
    if (Date.now() - state.lastPostedAt < INTERVAL_MS) return;
    const next = listProofs().find((name) => !state.posted.includes(name));
    if (!next) return;

    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) {
        console.warn(`[PAYMENT-PROOF] Channel ${CHANNEL_ID} not found or not a text channel.`);
        return;
    }
    await channel.send({ files: [new AttachmentBuilder(path.join(PROOFS_DIR, next), { name: `proof${path.extname(next).toLowerCase()}` })] });
    state.posted.push(next);
    state.lastPostedAt = Date.now();
    saveState(state);
    console.log(`[PAYMENT-PROOF] Posted ${next} in #${channel.name} (${state.posted.length} posted so far)`);
}

function startPaymentProofs(client) {
    const tick = () =>
        postNextProof(client).catch((error) => console.warn('[PAYMENT-PROOF] post failed:', error?.message || error));
    const { posted, lastPostedAt } = loadState();
    const remaining = listProofs().filter((name) => !posted.includes(name)).length;
    const nextAt = lastPostedAt ? new Date(lastPostedAt + INTERVAL_MS).toISOString() : 'now';
    console.log(`[PAYMENT-PROOF] ${remaining} proof(s) left to post · next at ${nextAt}`);
    tick();
    setInterval(tick, CHECK_EVERY_MS);
}

module.exports = { startPaymentProofs };
