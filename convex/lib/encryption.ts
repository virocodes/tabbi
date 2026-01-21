/**
 * Encryption utilities using AES-256-GCM with PBKDF2 key derivation
 *
 * Security features:
 * - AES-256-GCM for authenticated encryption
 * - PBKDF2 with 100,000 iterations for key derivation
 * - Random IV (initialization vector) per encryption
 * - Random salt per encryption
 */

const ALGORITHM = "AES-256-GCM";
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256;

/**
 * Derives an encryption key from a master secret and salt using PBKDF2
 */
async function deriveKey(masterSecret: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterSecret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Converts ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypts plaintext using AES-256-GCM
 *
 * @param plaintext - The text to encrypt (e.g., API key)
 * @param masterSecret - Master encryption secret from environment
 * @returns Object containing encrypted key, IV, salt, and algorithm
 */
export async function encryptSecret(
  plaintext: string,
  masterSecret: string
): Promise<{
  encryptedKey: string;
  iv: string;
  salt: string;
  algorithm: string;
}> {
  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive encryption key from master secret
  const key = await deriveKey(masterSecret, salt);

  // Encrypt the plaintext
  const encoder = new TextEncoder();
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    encoder.encode(plaintext)
  );

  return {
    encryptedKey: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypts ciphertext using AES-256-GCM
 *
 * @param encryptedKey - Base64-encoded encrypted data
 * @param iv - Base64-encoded initialization vector
 * @param salt - Base64-encoded salt
 * @param masterSecret - Master encryption secret from environment
 * @returns Decrypted plaintext
 */
export async function decryptSecret(
  encryptedKey: string,
  iv: string,
  salt: string,
  masterSecret: string
): Promise<string> {
  // Convert from base64
  const encryptedBuffer = base64ToUint8Array(encryptedKey);
  const ivBuffer = base64ToUint8Array(iv);
  const saltBuffer = base64ToUint8Array(salt);

  // Derive decryption key from master secret
  const key = await deriveKey(masterSecret, saltBuffer);

  // Decrypt the data
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBuffer,
    },
    key,
    encryptedBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
