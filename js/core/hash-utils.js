/**
 * hash-utils.js — File hashing utilities using Web Crypto API
 */

/**
 * Computes SHA-256 hash of an ArrayBuffer.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>} hex-encoded hash
 */
export async function computeHash(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes SHA-256 hash of a File object.
 * @param {File} file
 * @returns {Promise<string>} hex-encoded hash
 */
export async function computeFileHash(file) {
  const buffer = await file.arrayBuffer();
  return computeHash(buffer);
}
