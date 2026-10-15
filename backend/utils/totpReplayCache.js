/**
 * In-memory TTL cache for preventing TOTP token replay attacks.
 *
 * Per RFC 6238 section 5.2, an OTP verifier must not accept an OTP more than
 * once across authentication sessions for the same (or overlapping) time-step(s).
 *
 * Since otplib accepts tokens with ±1 window tolerance (period = 30s, tolerance = 1),
 * a token can be valid for up to 90 seconds. To prevent replay within this window,
 * consumed tokens are cached with a 120-second TTL.
 */

// Key: `${contactId}:${token}` -> Value: expiresAt (timestamp in ms)
const replayCache = new Map();

// Default TTL: 120 seconds (exceeds the 90-second ±1 window)
const DEFAULT_TTL_MS = 120 * 1000;

/**
 * Check if a TOTP token has already been consumed for a given contact
 * @param {string} contactId UUID of the trusted contact
 * @param {string} token 6-digit TOTP token
 * @returns {boolean} True if token was already consumed and has not yet expired
 */
function isTokenConsumed(contactId, token) {
    if (!contactId || !token) return false;
    const key = `${contactId}:${token}`;
    const expiresAt = replayCache.get(key);
    if (!expiresAt) return false;

    if (Date.now() > expiresAt) {
        replayCache.delete(key);
        return false;
    }
    return true;
}

/**
 * Mark a TOTP token as consumed
 * @param {string} contactId UUID of the trusted contact
 * @param {string} token 6-digit TOTP token
 * @param {number} ttlSeconds Expiration TTL in seconds (default 120s)
 */
function markTokenConsumed(contactId, token, ttlSeconds = 120) {
    if (!contactId || !token) return;
    const key = `${contactId}:${token}`;
    const expiresAt = Date.now() + (ttlSeconds * 1000);
    replayCache.set(key, expiresAt);
}

/**
 * Prune all expired entries from cache to prevent memory leaks
 */
function pruneExpiredEntries() {
    const now = Date.now();
    for (const [key, expiresAt] of replayCache.entries()) {
        if (now > expiresAt) {
            replayCache.delete(key);
        }
    }
}

/**
 * Clear all cache entries (primarily for test teardown)
 */
function clearCache() {
    replayCache.clear();
}

/**
 * Get current size of replay cache
 * @returns {number}
 */
function getCacheSize() {
    return replayCache.size;
}

// Automatic cleanup every 60 seconds (unref'd so it won't prevent process exit)
const pruneTimer = setInterval(pruneExpiredEntries, 60 * 1000);
if (pruneTimer.unref) {
    pruneTimer.unref();
}

module.exports = {
    isTokenConsumed,
    markTokenConsumed,
    pruneExpiredEntries,
    clearCache,
    getCacheSize,
    DEFAULT_TTL_MS
};
