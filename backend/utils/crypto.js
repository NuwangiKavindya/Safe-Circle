const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit initialization vector recommended for GCM
const PREFIX = 'enc:v1:';

/**
 * Derives a deterministic 32-byte (256-bit) encryption key.
 * Prioritizes TOTP_ENCRYPTION_KEY, ENCRYPTION_KEY, and falls back to
 * SHA-256 hash of JWT_SECRET to guarantee a consistent 32-byte buffer.
 *
 * @returns {Buffer} 32-byte key buffer
 */
function getEncryptionKey() {
    const rawKey = process.env.TOTP_ENCRYPTION_KEY ||
                   process.env.ENCRYPTION_KEY ||
                   process.env.JWT_SECRET ||
                   'safecircle-default-totp-encryption-key-fallback';

    return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypts a plaintext secret string using AES-256-GCM.
 * Output format: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * @param {string} plaintext - Raw text to encrypt (e.g. base32 TOTP secret)
 * @returns {string} Encrypted string prefixed with enc:v1:
 */
function encryptSecret(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') return plaintext;

    // Prevent double-encryption if already encrypted
    if (plaintext.startsWith(PREFIX)) return plaintext;

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a secret string previously encrypted with encryptSecret.
 * If the input does not start with enc:v1: (e.g. legacy unencrypted secret),
 * it returns the plaintext directly for graceful backward compatibility.
 *
 * @param {string} ciphertext - Encrypted string or legacy plaintext
 * @returns {string|null} Decrypted plaintext, or null on decryption failure
 */
function decryptSecret(ciphertext) {
    if (!ciphertext || typeof ciphertext !== 'string') return ciphertext;

    // Backward compatibility: legacy unencrypted base32 secrets pass through
    if (!ciphertext.startsWith(PREFIX)) return ciphertext;

    try {
        const parts = ciphertext.slice(PREFIX.length).split(':');
        if (parts.length !== 3) {
            console.error('[Crypto] Invalid encrypted secret format');
            return null;
        }

        const [ivHex, authTagHex, encryptedHex] = parts;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        console.error('[Crypto] Failed to decrypt secret:', err.message);
        return null;
    }
}

module.exports = {
    encryptSecret,
    decryptSecret,
    getEncryptionKey
};
