const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Key must be 32 bytes (64 hex chars)
const getKey = () => {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
};

/**
 * Encrypt a plaintext string
 * @returns {string} "ivHex:authTagHex:encryptedHex"
 */
const encrypt = (text) => {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypt an encrypted string
 * @param {string} encryptedData "ivHex:authTagHex:encryptedHex"
 * @returns {string} plaintext
 */
const decrypt = (encryptedData) => {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err.message);
    return '[encrypted message]';
  }
};

module.exports = { encrypt, decrypt };
