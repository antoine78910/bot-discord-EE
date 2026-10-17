/**
 * Launches both bots in the same process
 * - contentBot.js (content/creator management)
 * - index.js (main chatbot with AI support)
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('[LAUNCHER] Starting both bots...');

// Start content bot
const contentBot = spawn('node', ['contentBot.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env
});

contentBot.on('error', (error) => {
    console.error('[LAUNCHER] Content bot error:', error);
});

contentBot.on('exit', (code) => {
    console.warn('[LAUNCHER] Content bot exited with code:', code);
});

// Start main chatbot
const mainBot = spawn('node', ['index.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: process.env
});

mainBot.on('error', (error) => {
    console.error('[LAUNCHER] Main bot error:', error);
});

mainBot.on('exit', (code) => {
    console.warn('[LAUNCHER] Main bot exited with code:', code);
});

// Handle shutdown
process.on('SIGTERM', () => {
    console.log('[LAUNCHER] Shutting down...');
    contentBot.kill('SIGTERM');
    mainBot.kill('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('[LAUNCHER] Shutting down...');
    contentBot.kill('SIGINT');
    mainBot.kill('SIGINT');
});

console.log('[LAUNCHER] Both bots started!');
