import { prisma } from "./prisma.js";
import { Prisma } from "@prisma/client";
import redis from "./cache.js";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export interface UserData {
  firebaseUid: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  accessToken?: string;
  refreshToken?: string;
}

export async function clearUserCache(firebaseUid: string): Promise<void> {
  try {
    const pattern = `user:${firebaseUid}:*`;
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error("Error clearing user cache:", error);
  }
}

// Background job to clean up offline users
export async function cleanupOfflineUsers(): Promise<void> {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Find users who haven't been active for 2+ hours
    const offlineUsers = await prisma.user.findMany({
      where: {
        lastActive: {
          lt: twoHoursAgo,
        },
        isOnline: true,
      },
    });

    // Set them offline and clear their cache
    for (const user of offlineUsers) {
      await setUserOffline(user.firebaseUid);
    }

    console.log(`Cleaned up ${offlineUsers.length} offline users`);
  } catch (error) {
    console.error("Error cleaning up offline users:", error);
  }
}

export interface UserProfile extends UserData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  lastActive: Date;
  isOnline: boolean;
  onboardingStatus: string;
}

const AES_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const keyBase64 = process.env.TOKEN_ENCRYPTION_KEY;

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

// In local development, allow storing tokens without encryption if TOKEN_ENCRYPTION_KEY is not set
function tryEncrypt(plainText: string): string {
  try {
    return encryptSecret(plainText);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "TOKEN_ENCRYPTION_KEY missing/invalid. Storing token unencrypted in development."
      );
      return plainText;
    }
    throw e;
  }
}

function tryDecrypt(
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

function isReplicaSetError(error: unknown): boolean {
  const msg = (error as any)?.message?.toString().toLowerCase() || "";
  const code = (error as any)?.code;
  return (
    code === "P2031" ||
    msg.includes("replica set") ||
    msg.includes("replicaset") ||
    msg.includes("transactions") ||
    msg.includes("transaction")
  );
}

export async function storeUserTokens(
  firebaseUid: string,
  tokens: { accessToken?: string; refreshToken?: string | null }
): Promise<void> {
  const updateData: Record<string, string | undefined> = {};

  if (tokens.accessToken) {
    updateData.accessToken = tryEncrypt(tokens.accessToken);
  }

  if (tokens.refreshToken) {
    updateData.refreshToken = tryEncrypt(tokens.refreshToken);
  }

  if (Object.keys(updateData).length === 0) {
    return;
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { firebaseUid },
      data: updateData,
    });
  } catch (error) {
    if (isReplicaSetError(error)) {
      throw new Error(
        "Prisma update requires MongoDB replica set. See https://pris.ly/d/mongodb-replica-set or use docker-compose (rs0)."
      );
    }
    throw error;
  }
}

export async function getUserTokensDecrypted(
  firebaseUid: string
): Promise<{ accessToken?: string; refreshToken?: string } | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid } });

  if (!user) {
    return null;
  }

  return {
    accessToken: tryDecrypt(user.accessToken ?? undefined),
    refreshToken: tryDecrypt(user.refreshToken ?? undefined),
  };
}

type PrismaUserRecord = Awaited<ReturnType<typeof prisma.user.findUnique>>;

function toUserProfile(
  user: NonNullable<PrismaUserRecord>,
  isOnlineOverride?: boolean
): UserProfile {
  // Handle string dates that might come from raw MongoDB operations
  const lastActive =
    typeof user.lastActive === "string"
      ? new Date(user.lastActive)
      : user.lastActive;

  const createdAt =
    typeof user.createdAt === "string"
      ? new Date(user.createdAt)
      : user.createdAt;

  const updatedAt =
    typeof user.updatedAt === "string"
      ? new Date(user.updatedAt)
      : user.updatedAt;

  return {
    id: user.id,
    firebaseUid: user.firebaseUid,
    email: user.email,
    name: user.name,
    picture: user.picture,
    accessToken: user.accessToken || undefined,
    refreshToken: user.refreshToken || undefined,
    lastActive,
    isOnline: isOnlineOverride ?? user.isOnline,
    createdAt,
    updatedAt,
    onboardingStatus: user.onboardingStatus,
  };
}

export async function registerUser(userData: UserData): Promise<UserProfile> {
  try {
    // Check if user already exists
    let user = await prisma.user.findUnique({
      where: { firebaseUid: userData.firebaseUid },
    });

    if (!user) {
      // Create new user
      try {
        user = await prisma.user.create({
          data: {
            firebaseUid: userData.firebaseUid,
            email: userData.email,
            name: userData.name,
            picture: userData.picture,
            lastActive: new Date(),
            isOnline: true,
          },
        });
      } catch (error) {
        if (isReplicaSetError(error)) {
          throw new Error(
            "Prisma create requires MongoDB replica set. See https://pris.ly/d/mongodb-replica-set or use docker-compose (rs0)."
          );
        }
        console.error("Error creating user in database:", error);
        throw error;
      }
    } else {
      // Update existing user
      try {
        user = await prisma.user.update({
          where: { firebaseUid: userData.firebaseUid },
          data: {
            name: userData.name,
            picture: userData.picture,
            lastActive: new Date(),
            isOnline: true,
          },
        });
      } catch (error) {
        if (isReplicaSetError(error)) {
          throw new Error(
            "Prisma update requires MongoDB replica set. See https://pris.ly/d/mongodb-replica-set or use docker-compose (rs0)."
          );
        }
        console.error("Error updating user in database:", error);
        throw error;
      }
    }

    if (userData.accessToken || userData.refreshToken) {
      await storeUserTokens(userData.firebaseUid, {
        accessToken: userData.accessToken,
        refreshToken: userData.refreshToken,
      });
    }

    // Set user online status in Redis
    await setUserOnline(userData.firebaseUid);

    const refreshedUser = await prisma.user.findUnique({
      where: { firebaseUid: userData.firebaseUid },
    });

    if (!refreshedUser) {
      throw new Error("Failed to load user after registration");
    }

    return toUserProfile(refreshedUser, true);
  } catch (error) {
    console.error("Error registering user:", error);
    // Re-throw the original error to preserve the error details
    throw error;
  }
}

export async function getUserProfile(
  firebaseUid: string
): Promise<UserProfile | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { firebaseUid },
    });

    if (!user) {
      return null;
    }

    // Check online status from Redis
    const isOnline = await isUserOnline(firebaseUid);

    return toUserProfile(user, isOnline);
  } catch (error) {
    console.error("Error getting user profile:", error);
    throw new Error("Failed to get user profile");
  }
}

export async function setUserOnline(firebaseUid: string): Promise<void> {
  try {
    const key = `user:online:${firebaseUid}`;
    // Set user online with 2 hour expiration
    await redis.setex(key, 7200, Date.now().toString());

    // Update last active in database
    try {
      await prisma.user.update({
        where: { firebaseUid },
        data: {
          lastActive: new Date(),
          isOnline: true,
        },
      });
    } catch (error) {
      if (isReplicaSetError(error)) {
        throw new Error(
          "Prisma update requires MongoDB replica set. See https://pris.ly/d/mongodb-replica-set or use docker-compose (rs0)."
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("Error setting user online:", error);
  }
}

export async function setUserOffline(firebaseUid: string): Promise<void> {
  try {
    const key = `user:online:${firebaseUid}`;
    await redis.del(key);

    // Update database
    try {
      await prisma.user.update({
        where: { firebaseUid },
        data: { isOnline: false },
      });
    } catch (error) {
      if (isReplicaSetError(error)) {
        throw new Error(
          "Prisma update requires MongoDB replica set. See https://pris.ly/d/mongodb-replica-set or use docker-compose (rs0)."
        );
      }
      throw error;
    }

    // Clear user's message cache
    await clearUserCache(firebaseUid);
  } catch (error) {
    console.error("Error setting user offline:", error);
  }
}

export async function isUserOnline(firebaseUid: string): Promise<boolean> {
  try {
    const key = `user:online:${firebaseUid}`;
    const lastSeen = await redis.get(key);

    if (!lastSeen) {
      return false;
    }
    const lastSeenTime = parseInt(lastSeen, 10);
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000; // 2 hours in ms

    return lastSeenTime > twoHoursAgo;
  } catch (error) {
    console.error("Error checking user online status:", error);
    return false;
  }
}
