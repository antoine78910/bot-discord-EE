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

const FILES_DIR = process.env.CONTENT_FILES_DIR || path.join(os.tmpdir(), 'ee-content-files');
const PUBLIC_URL = String(
    process.env.CONTENT_PUBLIC_URL ||
        (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
).replace(/\/+$/, '');
const TTL_MS = Number(process.env.CONTENT_FILE_TTL_DAYS || 7) * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[a-f0-9]{32}$/;

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

/** Copies the files into a fresh private folder. Returns { page, files: [{ name, url, download }] }. */
async function publishFiles(paths, title) {
    const token = crypto.randomBytes(16).toString('hex');
    const dir = path.join(FILES_DIR, token);
    await fs.promises.mkdir(dir, { recursive: true });
    const names = [];
    for (const source of paths) {
        const name = path.basename(source);
        await fs.promises.copyFile(source, path.join(dir, name));
        names.push(name);
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
</style></head><body><h1>${escapeHtml(meta.title)}</h1><p>Original files, full quality. Links expire after ${Math.round(TTL_MS / 86400000)} days.</p>
<div class="grid">${cards}</div></body></html>`;
}

function sendFile(req, res, filePath, name, download) {
    const stat = fs.statSync(filePath);
    const headers = {
        'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=86400',
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

async function cleanupExpired() {
    const entries = await fs.promises.readdir(FILES_DIR, { withFileTypes: true }).catch(() => []);
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory() || !TOKEN_RE.test(entry.name)) continue;
        const dir = path.join(FILES_DIR, entry.name);
        const stat = await fs.promises.stat(dir).catch(() => null);
        if (stat && now - stat.mtimeMs > TTL_MS) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
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
    });
    cleanupExpired();
    setInterval(cleanupExpired, 6 * 60 * 60 * 1000).unref();
}

module.exports = { addRoute, isHostingEnabled, publishFiles, startFileServer };
