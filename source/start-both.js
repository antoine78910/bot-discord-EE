/**
 * Launches content + ticket bots.
 *
 * Discord allows only ONE gateway session per bot token. If both processes
 * share the same token, interactions randomly fail ("Échec de l'interaction")
 * because the event may land on the process that does not handle it.
 *
 * Rules:
 * - Two different tokens → start both
 * - Only CONTENT_BOT_TOKEN → contentBot only
 * - Only DISCORD_BOT_TOKEN → index only
 * - Same token for both → contentBot only (set DISCORD_BOT_TOKEN on a
 *   separate Railway service if you also need the ticket AI bot)
 */
const { spawn } = require('child_process');

const contentToken = String(process.env.CONTENT_BOT_TOKEN || '').trim();
const mainToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();

function start(entry) {
    console.log(`[LAUNCHER] Starting ${entry}...`);
    const child = spawn('node', [entry], {
        cwd: __dirname,
        stdio: 'inherit',
        env: process.env,
    });
    child.on('error', (error) => {
        console.error(`[LAUNCHER] ${entry} error:`, error);
    });
    child.on('exit', (code) => {
        console.warn(`[LAUNCHER] ${entry} exited with code:`, code);
        // If the only / primary process dies, exit so Railway restarts.
        process.exit(code || 0);
    });
    return child;
}

const children = [];

if (contentToken && mainToken && contentToken !== mainToken) {
    console.log('[LAUNCHER] Two distinct bot tokens — starting contentBot + index');
    children.push(start('contentBot.js'));
    // index must not fall back onto CONTENT_BOT_TOKEN
    const main = spawn('node', ['index.js'], {
        cwd: __dirname,
        stdio: 'inherit',
        env: { ...process.env, CONTENT_BOT_TOKEN: '' },
    });
    main.on('error', (error) => console.error('[LAUNCHER] index.js error:', error));
    main.on('exit', (code) => {
        console.warn('[LAUNCHER] index.js exited with code:', code);
    });
    children.push(main);
} else if (contentToken && (!mainToken || contentToken === mainToken)) {
    if (mainToken && contentToken === mainToken) {
        console.warn(
            '[LAUNCHER] CONTENT_BOT_TOKEN === DISCORD_BOT_TOKEN — starting contentBot ONLY. ' +
                'Run the ticket bot on a separate Discord app/token (or set BOT_ENTRY=index.js on another service).'
        );
    } else {
        console.log('[LAUNCHER] CONTENT_BOT_TOKEN only — starting contentBot');
    }
    children.push(start('contentBot.js'));
} else if (mainToken) {
    console.log('[LAUNCHER] DISCORD_BOT_TOKEN only — starting index');
    children.push(start('index.js'));
} else {
    console.error('[LAUNCHER] No DISCORD_BOT_TOKEN or CONTENT_BOT_TOKEN set — cannot start.');
    process.exit(1);
}

function shutdown(signal) {
    console.log(`[LAUNCHER] Shutting down (${signal})...`);
    for (const child of children) {
        try {
            child.kill(signal);
        } catch {}
    }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[LAUNCHER] Ready');
