const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildOtpAppReply,
    collectImageAttachments,
    isOtpCodeRequest,
    shouldUseVisionForMessage,
} = require('./support');

test('detects natural-language OTP / code requests', () => {
    assert.equal(isOtpCodeRequest('i need a code'), true);
    assert.equal(isOtpCodeRequest('can you send my otp?'), true);
    assert.equal(isOtpCodeRequest('where do i get the authenticator code'), true);
    assert.equal(isOtpCodeRequest('my billing page is broken'), false);
});

test('collects only image attachments from a Discord-like message payload', () => {
    const attachments = new Map([
        ['1', { url: 'https://cdn.test/screenshot.png', contentType: 'image/png', name: 'screenshot.png' }],
        ['2', { url: 'https://cdn.test/archive.zip', contentType: 'application/zip', name: 'archive.zip' }],
        ['3', { url: 'https://cdn.test/photo.jpg', name: 'photo.jpg' }],
    ]);

    assert.deepEqual(collectImageAttachments({ attachments }), [
        { url: 'https://cdn.test/screenshot.png', contentType: 'image/png', name: 'screenshot.png' },
        { url: 'https://cdn.test/photo.jpg', contentType: '', name: 'photo.jpg' },
    ]);
});

test('uses vision when a user message includes an image attachment', () => {
    const attachments = new Map([
        ['1', { url: 'https://cdn.test/screenshot.png', contentType: 'image/png', name: 'screenshot.png' }],
    ]);

    assert.equal(
        shouldUseVisionForMessage({
            author: { bot: false },
            content: 'here is the error',
            attachments,
        }),
        true
    );
});

test('builds the OTP app reply in English', () => {
    assert.match(buildOtpAppReply(), /go to the app/i);
    assert.match(buildOtpAppReply(), /otp/i);
});
