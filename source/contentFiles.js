/**
 * Full-quality download links for generated content (Discord recompresses previews
 * and caps upload size, so originals are served from the bot instead).
 *
 * Env:
 *   CONTENT_PUBLIC_URL      public base URL (default: https://$RAILWAY_PUBLIC_DOMAIN)
 *   CONTENT_FILES_DIR       storage folder (mount a Railway volume here to survive redeploys)
 *   CONTENT_FILE_TTL_DAYS   files are deleted after this many days (default 14)
 *   PORT                    HTTP port (Railway injects it)
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const FILES_DIR =
    process.env.CONTENT_FILES_DIR ||
    (fs.existsSync('/data') ? '/data/content-files' : path.join(os.tmpdir(), 'ee-content-files'));
const PUBLIC_URL = String(
    process.env.CONTENT_PUBLIC_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
).replace(/\/+$/, '');
// Prefer hours when set (cheaper: shorter hosted lifetime → less volume + less egress).
const TTL_MS = process.env.CONTENT_FILE_TTL_HOURS
    ? Number(process.env.CONTENT_FILE_TTL_HOURS) * 60 * 60 * 1000
    : Number(process.env.CONTENT_FILE_TTL_DAYS || 1) * 24 * 60 * 60 * 1000;
const MAX_FOLDERS = Number(process.env.CONTENT_FILES_MAX_FOLDERS || 12);
const DISK_WARNING_THRESHOLD = 0.55;
const DISK_CLEANUP_THRESHOLD = 0.70;
const VOLUME_BYTES = Number(process.env.CONTENT_VOLUME_BYTES || 5 * 1024 * 1024 * 1024);
const STARTUP_KEEP = Number(process.env.CONTENT_STARTUP_KEEP_FOLDERS || 2);
const TARGET_FREE_BYTES = Number(process.env.CONTENT_TARGET_FREE_MB || 2000) * 1024 * 1024;
const TOKEN_RE = /^[a-f0-9]{32}$/;
const TMP_CONTENT_DIR = path.join(os.tmpdir(), 'ee-content');

const MIME = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
};

function isHostingEnabled() {
    return Boolean(PUBLIC_URL);
}

function fileUrl(token, name, download = false) {
    return `${PUBLIC_URL}/f/${token}/${encodeURIComponent(name)}${download ? '?dl=1' : ''}`;
}

async function neededBytes(paths) {
    let total = 0;
    for (const source of paths) {
        const stat = await fs.promises.stat(source).catch(() => null);
        if (stat) total += stat.size;
    }
    return total + 8 * 1024 * 1024;
}

/** Copies the files into a fresh private folder. Returns { page, files: [{ name, url, download }] }. */
async function publishFiles(paths, title) {
    await fs.promises.mkdir(FILES_DIR, { recursive: true }).catch(() => {});
    const need = await neededBytes(paths);
    await ensureFreeSpace(need);

    const token = crypto.randomBytes(16).toString('hex');
    const dir = path.join(FILES_DIR, token);

    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
        if (error?.code === 'ENOSPC') {
            console.error('[CONTENT-FILES] 🚨 DISK FULL on mkdir — nuclear cleanup...');
            await freeSpaceUntil(need, { nuclear: true });
            await fs.promises.mkdir(dir, { recursive: true });
        } else {
            throw error;
        }
    }

    const names = [];
    for (const source of paths) {
        const name = path.basename(source);
        const dest = path.join(dir, name);
        try {
            await fs.promises.copyFile(source, dest);
            names.push(name);
        } catch (error) {
            if (error?.code === 'ENOSPC') {
                console.error('[CONTENT-FILES] 🚨 DISK FULL during copy — nuclear cleanup...');
                await freeSpaceUntil(need, { nuclear: true });
                await fs.promises.copyFile(source, dest);
                names.push(name);
            } else {
                throw error;
            }
        }
    }
    await fs.promises.writeFile(
        path.join(dir, 'meta.json'),
        JSON.stringify({ title, created: Date.now(), files: names })
    );
    return {
        page: `${PUBLIC_URL}/f/${token}/`,
        files: names.map((name) => ({ name, url: fileUrl(token, name), download: fileUrl(token, name, true) })),
    };
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderPage(token, meta) {
    const cards = meta.files
        .map((name) => {
            const ext = path.extname(name).toLowerCase();
            const src = fileUrl(token, name);
            const preview = MIME[ext]?.startsWith('image/')
                ? `<img src="${src}" loading="lazy">`
                : MIME[ext]?.startsWith('video/')
                  ? `<video src="${src}" controls playsinline preload="metadata"></video>`
                  : '<div class="file">📦</div>';
            return `<div class="card">${preview}<a class="btn" href="${fileUrl(token, name, true)}">⬇ ${escapeHtml(name)}</a></div>`;
        })
        .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(meta.title)}</title><style>
body{margin:0;background:#0f1115;color:#eee;font-family:system-ui,sans-serif;padding:16px}
h1{font-size:18px;margin:0 0 4px}p{color:#999;font-size:13px;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.card{background:#1a1d24;border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:8px}
img,video{width:100%;border-radius:6px;background:#000}.file{font-size:48px;text-align:center;padding:30px 0}
.btn{display:block;text-align:center;background:#8b5cf6;color:#fff;text-decoration:none;padding:9px;border-radius:7px;font-size:13px;word-break:break-all}
</style></head><body><h1>${escapeHtml(meta.title)}</h1><p>Original files, full quality. Links expire after ${
        TTL_MS < 86400000
            ? `${Math.max(1, Math.round(TTL_MS / 3600000))} hours`
            : `${Math.round(TTL_MS / 86400000)} day(s)`
    }.</p>
<div class="grid">${cards}</div></body></html>`;
}

function sendFile(req, res, filePath, name, download) {
    const stat = fs.statSync(filePath);
    const headers = {
        'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        // Long cache: Discord/CDN revalidate less → less Railway egress.
        'Cache-Control': 'public, max-age=604800, immutable',
    };
    if (download) headers['Content-Disposition'] = `attachment; filename="${name.replace(/"/g, '')}"`;

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (start >= stat.size || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
            res.end();
            return;
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).pipe(res);
}

/** Extra endpoints served by the same HTTP server, keyed by "METHOD /path". */
const routes = new Map();

function addRoute(method, pathname, handler) {
    routes.set(`${method} ${pathname}`, handler);
}

function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = routes.get(`${req.method} ${url.pathname}`);
    if (route) {
        Promise.resolve(route(req, res)).catch((error) => {
            console.warn(`[CONTENT-FILES] ${url.pathname} failed:`, error?.message || error);
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
        return;
    }
    if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    const match = /^\/f\/([^/]+)\/(.*)$/.exec(url.pathname);
    const token = match?.[1];
    if (!match || !TOKEN_RE.test(token) || !['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }
    const dir = path.join(FILES_DIR, token);
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Link expired or not found');
        return;
    }
    const name = decodeURIComponent(match[2] || '');
    if (!name) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' });
        res.end(renderPage(token, meta));
        return;
    }
    if (!meta.files.includes(name)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }
    sendFile(req, res, path.join(dir, name), name, url.searchParams.has('dl'));
}

async function listContentFolders() {
    const entries = await fs.promises.readdir(FILES_DIR, { withFileTypes: true }).catch(() => []);
    const folders = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !TOKEN_RE.test(entry.name)) continue;
        const dir = path.join(FILES_DIR, entry.name);
        const stat = await fs.promises.stat(dir).catch(() => null);
        if (stat) folders.push({ name: entry.name, dir, mtime: stat.mtimeMs });
    }
    folders.sort((a, b) => a.mtime - b.mtime);
    return folders;
}

async function removeFolder(folder) {
    const size = await getDirectorySize(folder.dir);
    await fs.promises.rm(folder.dir, { recursive: true, force: true });
    return size;
}

async function cleanupExpired() {
    const folders = await listContentFolders();
    const now = Date.now();
    let cleaned = 0;
    let freedSpace = 0;
    for (const folder of folders) {
        if (now - folder.mtime <= TTL_MS) continue;
        try {
            freedSpace += await removeFolder(folder);
            cleaned++;
        } catch (error) {
            console.warn('[CONTENT-FILES] Could not cleanup', folder.name, ':', error?.message);
        }
    }
    if (cleaned > 0) {
        console.log(`[CONTENT-FILES] Cleaned ${cleaned} expired folders (freed ${formatSize(freedSpace)})`);
    }
    return freedSpace;
}

async function cleanupTempJobs() {
    let freed = 0;
    const roots = [TMP_CONTENT_DIR, path.join(os.tmpdir(), 'ee-content-files')];
    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        if (path.resolve(root) === path.resolve(FILES_DIR)) continue;
        const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const full = path.join(root, entry.name);
            try {
                const size = entry.isDirectory()
                    ? await getDirectorySize(full)
                    : (await fs.promises.stat(full)).size;
                await fs.promises.rm(full, { recursive: true, force: true });
                freed += size;
            } catch {}
        }
    }
    if (freed > 0) {
        console.log(`[CONTENT-FILES] Cleared temp generation folders (freed ${formatSize(freed)})`);
    }
    return freed;
}

/** Delete oldest published folders until enough free space (ignores age when nuclear). */
async function freeSpaceUntil(bytesNeeded, { nuclear = false, keep = 5 } = {}) {
    let freed = await cleanupExpired();
    freed += await cleanupTempJobs();
    freed += await enforceMaxFolders(nuclear ? keep : MAX_FOLDERS);

    const usage = await checkDiskUsage({ cleanup: false });
    if (usage && usage.freeBytes >= bytesNeeded && !nuclear) return freed;

    const folders = await listContentFolders();
    const removable = nuclear ? folders.slice(0, Math.max(0, folders.length - keep)) : folders;
    console.log(
        `[CONTENT-FILES] 🚨 Freeing space (need ${formatSize(bytesNeeded)}, nuclear=${nuclear}) — ${removable.length} candidate(s)`
    );

    for (const folder of removable) {
        try {
            freed += await removeFolder(folder);
        } catch (error) {
            console.warn('[CONTENT-FILES] Remove failed', folder.name, ':', error?.message);
        }
        const now = await checkDiskUsage({ cleanup: false });
        if (now && now.freeBytes >= bytesNeeded) break;
    }
    console.log(`[CONTENT-FILES] 🚨 Freed ${formatSize(freed)} total`);
    return freed;
}

async function ensureFreeSpace(bytesNeeded) {
    const usage = await checkDiskUsage({ cleanup: false });
    if (!usage || usage.freeBytes < bytesNeeded || usage.usagePercent >= DISK_WARNING_THRESHOLD) {
        console.log(
            `[CONTENT-FILES] Cleaning before publish (need ${formatSize(bytesNeeded)}, free ${formatSize(usage?.freeBytes || 0)})...`
        );
        await freeSpaceUntil(bytesNeeded, { nuclear: !usage || usage.freeBytes < bytesNeeded });
    }
}

async function emergencyCleanup() {
    return freeSpaceUntil(500 * 1024 * 1024, { nuclear: true, keep: 3 });
}

async function enforceMaxFolders(max = MAX_FOLDERS) {
    const folders = await listContentFolders();
    const toRemove = folders.length - max;
    if (toRemove <= 0) return 0;

    console.log(`[CONTENT-FILES] 📊 Folder limit (${folders.length}/${max}) — removing ${toRemove} oldest...`);
    let removed = 0;
    let freedSpace = 0;
    for (const folder of folders.slice(0, toRemove)) {
        try {
            freedSpace += await removeFolder(folder);
            removed++;
        } catch (error) {
            console.warn('[CONTENT-FILES] Could not remove old folder', folder.name, ':', error?.message);
        }
    }
    console.log(`[CONTENT-FILES] 📊 Removed ${removed} oldest folders (freed ${formatSize(freedSpace)})`);
    return freedSpace;
}

async function dfFreeBytes(targetPath) {
    try {
        const { stdout } = await execFileAsync('df', ['-k', targetPath], { timeout: 5000 });
        const lines = stdout.trim().split('\n');
        if (lines.length < 2) return null;
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        const availableKb = Number(parts[3]);
        return Number.isFinite(availableKb) ? availableKb * 1024 : null;
    } catch {
        return null;
    }
}

async function checkDiskUsage({ cleanup = true } = {}) {
    try {
        await fs.promises.mkdir(FILES_DIR, { recursive: true });
        const totalSize = await getDirectorySize(FILES_DIR);
        const freeFromDf = await dfFreeBytes(FILES_DIR);
        const maxSize = VOLUME_BYTES;
        const freeBytes = freeFromDf != null ? freeFromDf : Math.max(0, maxSize - totalSize);
        const usagePercent =
            freeFromDf != null
                ? Math.max(0, Math.min(1, 1 - freeFromDf / Math.max(freeFromDf + totalSize, 1)))
                : totalSize / maxSize;

        if (cleanup && (usagePercent >= DISK_CLEANUP_THRESHOLD || freeBytes < 300 * 1024 * 1024)) {
            console.warn(
                `[CONTENT-FILES] ⚠️  Disk high (${Math.round(usagePercent * 100)}%, free ${formatSize(freeBytes)}) — cleanup`
            );
            await freeSpaceUntil(400 * 1024 * 1024, { nuclear: false });
        } else if (cleanup && usagePercent >= DISK_WARNING_THRESHOLD) {
            console.warn(`[CONTENT-FILES] ⚠️  Disk usage at ${Math.round(usagePercent * 100)}%`);
        }

        return { totalSize, maxSize, usagePercent, freeBytes };
    } catch (error) {
        console.warn('[CONTENT-FILES] Could not check disk usage:', error?.message);
        return null;
    }
}

async function getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                const stat = await fs.promises.stat(fullPath);
                totalSize += stat.size;
            } else if (entry.isDirectory()) {
                totalSize += await getDirectorySize(fullPath);
            }
        }
    } catch (error) {
        // Ignore errors
    }
    return totalSize;
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function startFileServer() {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    const port = Number(process.env.PORT || process.env.CONTENT_FILES_PORT || 8080);
    http.createServer((req, res) => {
        try {
            handleRequest(req, res);
        } catch (error) {
            console.warn('[CONTENT-FILES] request failed:', error?.message || error);
            if (!res.headersSent) res.writeHead(500);
            res.end();
        }
    }).listen(port, () => {
        console.log(`[CONTENT-FILES] Serving ${FILES_DIR} on :${port} → ${PUBLIC_URL || '(no public URL, links disabled)'}`);
        console.log(`[CONTENT-FILES] TTL: ${Math.round(TTL_MS / 86400000)} days | Max folders: ${MAX_FOLDERS}`);
    });
    
    console.log('[CONTENT-FILES] 🔧 Running startup maintenance...');
    (async () => {
        await cleanupTempJobs().catch(() => {});
        await cleanupExpired().catch((err) => console.warn('[CONTENT-FILES] Startup cleanup failed:', err?.message));
        await enforceMaxFolders(MAX_FOLDERS).catch((err) =>
            console.warn('[CONTENT-FILES] Folder limit check failed:', err?.message)
        );
        // Always aim for ~2GB free on boot — volume at 99% is the #1 Railway cost/failure driver.
        const usage = await checkDiskUsage({ cleanup: false });
        if (!usage || usage.freeBytes < TARGET_FREE_BYTES || usage.usagePercent >= 0.70) {
            console.warn(
                `[CONTENT-FILES] 🚨 Startup reclaim — target free ${formatSize(TARGET_FREE_BYTES)} (keep ${STARTUP_KEEP} newest)`
            );
            await freeSpaceUntil(TARGET_FREE_BYTES, { nuclear: true, keep: STARTUP_KEEP });
        }
        const after = await checkDiskUsage({ cleanup: false });
        if (after) {
            console.log(
                `[CONTENT-FILES] 📊 Disk: used ${formatSize(after.totalSize)} · free ${formatSize(after.freeBytes)} · ~${Math.round(after.usagePercent * 100)}% · dir=${FILES_DIR}`
            );
        }
    })();

    // Every 15 min — keep volume/egress costs down.
    setInterval(() => {
        (async () => {
            await cleanupTempJobs().catch(() => {});
            await cleanupExpired().catch((err) => console.warn('[CONTENT-FILES] Periodic cleanup failed:', err?.message));
            await enforceMaxFolders().catch((err) => console.warn('[CONTENT-FILES] Folder limit check failed:', err?.message));
            const usage = await checkDiskUsage({ cleanup: false });
            if (usage && usage.freeBytes < TARGET_FREE_BYTES * 0.5) {
                await freeSpaceUntil(TARGET_FREE_BYTES, { nuclear: true, keep: STARTUP_KEEP });
            }
        })();
    }, 15 * 60 * 1000).unref();
}

module.exports = { addRoute, isHostingEnabled, publishFiles, startFileServer };
