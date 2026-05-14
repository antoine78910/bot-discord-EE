const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i;

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function isOtpCodeRequest(content) {
    const text = normalizeText(content);
    if (!text) return false;

    return [
        /\bi need a code\b/i,
        /\bneed (?:the )?code\b/i,
        /\bneed (?:my )?otp\b/i,
        /\botp\b/i,
        /\b2fa\b/i,
        /\bauthenticator code\b/i,
        /\bverification code\b/i,
        /\blogin code\b/i,
    ].some((pattern) => pattern.test(text));
}

function toAttachmentArray(attachments) {
    if (!attachments) return [];
    if (Array.isArray(attachments)) return attachments;
    if (typeof attachments.values === 'function') {
        try {
            return Array.from(attachments.values());
        } catch {}
    }
    if (typeof attachments.forEach === 'function') {
        const items = [];
        try {
            attachments.forEach((item) => items.push(item));
            return items;
        } catch {}
    }
    return [];
}

function collectImageAttachments(message) {
    return toAttachmentArray(message?.attachments)
        .map((attachment) => ({
            url: String(attachment?.url || '').trim(),
            contentType: String(attachment?.contentType || '').trim(),
            name: String(attachment?.name || '').trim(),
        }))
        .filter((attachment) => {
            if (!attachment.url) return false;
            if (/^image\//i.test(attachment.contentType)) return true;
            return IMAGE_NAME_RE.test(attachment.name || attachment.url);
        });
}

function shouldUseVisionForMessage(message) {
    if (message?.author?.bot) return false;
    return collectImageAttachments(message).length > 0;
}

function buildOtpAppReply() {
    return 'Go to the app to get your OTP code. Open the app, then use the OTP section there to retrieve the current code.';
}

module.exports = {
    buildOtpAppReply,
    collectImageAttachments,
    isOtpCodeRequest,
    shouldUseVisionForMessage,
};
