const { NobleCryptoPlugin, ScureBase32Plugin, TOTP } = require('otplib');

/**
 * RFC 6238 TOTP configuration:
 * - Period = 30 seconds (standard step)
 * - epochTolerance = 1 (±1 window allows ±30s clock drift between contact device and server)
 * - Algorithm: SHA1, Digits: 6
 */
const totpEngine = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    period: 30,
    epochTolerance: 1
});

/**
 * Generate a random base32 cryptographic TOTP secret
 * @returns {string} base32 secret
 */
const generateSecret = () => {
    return totpEngine.generateSecret();
};

/**
 * Build standard otpauth:// provisioning URI for QR code generation & authenticator apps
 * @param {string} label Account identifier (e.g. "SafeCircle:Jane")
 * @param {string} secret Base32 secret
 * @param {string} issuer System issuer name (default: "SafeCircle")
 * @returns {string} otpauth URI
 */
const generateURI = (label, secret, issuer = 'SafeCircle') => {
    return totpEngine.toURI({ secret, label, issuer });
};

/**
 * Validate an incoming 6-digit TOTP token against a base32 secret
 * @param {string} token 6-digit token from authenticator app
 * @param {string} secret Stored base32 secret
 * @returns {Promise<boolean>} True if valid within tolerance window
 */
const verifyToken = async (token, secret) => {
    try {
        if (!token || !secret) return false;
        const result = await totpEngine.verify(token, { secret });
        return result && result.valid === true;
    } catch (err) {
        return false;
    }
};

/**
 * Generate a 6-digit TOTP token for testing and verification
 * @param {string} secret Base32 secret
 * @returns {Promise<string>} 6-digit token
 */
const generateToken = async (secret) => {
    return await totpEngine.generate({ secret });
};

module.exports = {
    generateSecret,
    generateURI,
    verifyToken,
    generateToken
};
