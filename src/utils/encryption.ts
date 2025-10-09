import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import config from "../config/index";

const AES_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const keyBase64 = config.tokenEncryptionKey;

  if (!keyBase64) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate a 32-byte base64 value and add it to your .env file."
    );
  }

  const key = Buffer.from(keyBase64, "base64");

  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key for AES-256-GCM."
    );
  }

  return key;
}

export function encryptSecret(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit nonce for GCM
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${authTag.toString(
    "base64"
  )}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const [ivPart, tagPart, dataPart] = payload.split(".");

  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted payload format.");
  }

  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const data = Buffer.from(dataPart, "base64");

  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// In development, allow storing tokens without encryption if key is not set
export function tryEncrypt(plainText: string): string {
  try {
    return encryptSecret(plainText);
  } catch (e) {
    if (config.nodeEnv !== "production") {
      console.warn(
        "TOKEN_ENCRYPTION_KEY missing/invalid. Storing token unencrypted in development."
      );
      return plainText;
    }
    throw e;
  }
}

export function tryDecrypt(
  possiblyEncrypted: string | null | undefined
): string | undefined {
  if (!possiblyEncrypted) return undefined;
  try {
    return decryptSecret(possiblyEncrypted);
  } catch {
    // Likely stored in plain text in dev
    return possiblyEncrypted;
  }
}
