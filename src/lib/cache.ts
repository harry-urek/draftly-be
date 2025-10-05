import Redis from "ioredis";
import { slackNotifier } from "./slack.js";

// Use REDIS_URL if available (Docker), otherwise fall back to individual settings
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
    })
  : new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    });

redis.on("error", async (error) => {
  console.error("Redis connection error:", error);

  // Send cache error notification to Slack
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.cacheError("Redis Connection Error", error);
  }
});

redis.on("connect", () => {
  console.log("Connected to Redis");
});

// User session management
export const CACHE_KEYS = {
  USER_MESSAGES: (userId: string) => `user:${userId}:messages`,
  USER_PRESENCE: (userId: string) => `user:${userId}:presence`,
  USER_TOKENS: (userId: string) => `user:${userId}:tokens`,
};

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  MESSAGES: 60 * 60, // 1 hour
  PRESENCE: 60 * 5, // 5 minutes
  OFFLINE_EXPIRY: 60 * 60 * 2, // 2 hours
};

export class CacheManager {
  static async setUserMessages(userId: string, messages: any[]) {
    const key = CACHE_KEYS.USER_MESSAGES(userId);
    await redis.setex(key, CACHE_TTL.MESSAGES, JSON.stringify(messages));
  }

  static async getUserMessages(userId: string): Promise<any[] | null> {
    const key = CACHE_KEYS.USER_MESSAGES(userId);
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  static async updateUserPresence(userId: string) {
    const key = CACHE_KEYS.USER_PRESENCE(userId);
    await redis.setex(key, CACHE_TTL.PRESENCE, Date.now().toString());
  }

  static async getUserPresence(userId: string): Promise<number | null> {
    const key = CACHE_KEYS.USER_PRESENCE(userId);
    const presence = await redis.get(key);
    return presence ? parseInt(presence) : null;
  }

  static async isUserOnline(userId: string): Promise<boolean> {
    const lastSeen = await this.getUserPresence(userId);
    if (!lastSeen) return false;

    const now = Date.now();
    const timeDiff = now - lastSeen;
    return timeDiff < CACHE_TTL.PRESENCE * 1000; // Convert to milliseconds
  }

  static async clearUserCache(userId: string) {
    const keys = [
      CACHE_KEYS.USER_MESSAGES(userId),
      CACHE_KEYS.USER_PRESENCE(userId),
      CACHE_KEYS.USER_TOKENS(userId),
    ];
    await redis.del(...keys);
  }

  static async setUserTokens(
    userId: string,
    tokens: { accessToken?: string; refreshToken?: string }
  ) {
    const key = CACHE_KEYS.USER_TOKENS(userId);
    await redis.setex(key, CACHE_TTL.OFFLINE_EXPIRY, JSON.stringify(tokens));
  }

  static async getUserTokens(
    userId: string
  ): Promise<{ accessToken?: string; refreshToken?: string } | null> {
    const key = CACHE_KEYS.USER_TOKENS(userId);
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  // Cleanup offline users (run periodically)
  static async cleanupOfflineUsers() {
    const pattern = CACHE_KEYS.USER_PRESENCE("*");
    const keys = await redis.keys(pattern);

    for (const key of keys) {
      const userId = key.split(":")[1];
      const isOnline = await this.isUserOnline(userId);

      if (!isOnline) {
        console.log(`Cleaning up cache for offline user: ${userId}`);
        await this.clearUserCache(userId);
      }
    }
  }
}

export default redis;
