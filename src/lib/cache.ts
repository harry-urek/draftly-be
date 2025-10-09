import Redis from "ioredis";

import type { EmailDraft, EmailMessage, EmailThread } from "../types/index.js";

// eslint-disable-next-line import/no-unresolved
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
  console.warn("Connected to Redis");
});

// User session management
export const CACHE_KEYS = {
  USER_THREADS: (userId: string) => `user:${userId}:threads`,
  USER_THREAD_DETAIL: (userId: string, threadId: string) =>
    `user:${userId}:thread:${threadId}`,
  USER_THREAD_DETAIL_PREFIX: (userId: string) =>
    `user:${userId}:thread:` as const,
  USER_DRAFTS: (userId: string) => `user:${userId}:drafts`,
  USER_STARRED: (userId: string) => `user:${userId}:starred`,
  USER_PRESENCE: (userId: string) => `user:${userId}:presence`,
  USER_TOKENS: (userId: string) => `user:${userId}:tokens`,
};

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  MAIL: 60 * 5, // 5 minutes
  PRESENCE: 60 * 5, // 5 minutes
  OFFLINE_EXPIRY: 60 * 60 * 2, // 2 hours
};

export class CacheManager {
  private static async setJson<T>(key: string, ttl: number, value: T) {
    await redis.setex(key, ttl, JSON.stringify(value));
  }

  private static parseJson<T>(raw: string | null): T | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error("Failed to parse cache payload", error);
      return null;
    }
  }

  static async getThreads(userId: string): Promise<EmailThread[] | null> {
    const key = CACHE_KEYS.USER_THREADS(userId);
    const cached = await redis.get(key);
    return this.parseJson<EmailThread[]>(cached);
  }

  static async setThreads(
    userId: string,
    threads: EmailThread[]
  ): Promise<void> {
    const key = CACHE_KEYS.USER_THREADS(userId);
    await this.setJson(key, CACHE_TTL.MAIL, threads);
  }

  static async getThreadDetail(
    userId: string,
    threadId: string
  ): Promise<EmailThread | null> {
    const key = CACHE_KEYS.USER_THREAD_DETAIL(userId, threadId);
    const cached = await redis.get(key);
    return this.parseJson<EmailThread>(cached);
  }

  static async setThreadDetail(
    userId: string,
    thread: EmailThread
  ): Promise<void> {
    const key = CACHE_KEYS.USER_THREAD_DETAIL(userId, thread.id);
    await this.setJson(key, CACHE_TTL.MAIL, thread);
  }

  static async upsertThread(
    userId: string,
    thread: EmailThread
  ): Promise<void> {
    const threads = (await this.getThreads(userId)) ?? [];
    const existingIndex = threads.findIndex((item) => item.id === thread.id);
    const nextThreads =
      existingIndex >= 0
        ? threads.map((item) => (item.id === thread.id ? thread : item))
        : [thread, ...threads];
    await this.setThreads(userId, nextThreads);
    await this.setThreadDetail(userId, thread);
  }

  static async getDrafts(userId: string): Promise<EmailDraft[] | null> {
    const key = CACHE_KEYS.USER_DRAFTS(userId);
    const cached = await redis.get(key);
    return this.parseJson<EmailDraft[]>(cached);
  }

  static async setDrafts(userId: string, drafts: EmailDraft[]): Promise<void> {
    const key = CACHE_KEYS.USER_DRAFTS(userId);
    await this.setJson(key, CACHE_TTL.MAIL, drafts);
  }

  static async upsertDraft(userId: string, draft: EmailDraft): Promise<void> {
    const drafts = (await this.getDrafts(userId)) ?? [];
    const nextDrafts = drafts.some((item) => item.id === draft.id)
      ? drafts.map((item) => (item.id === draft.id ? draft : item))
      : [draft, ...drafts];
    await this.setDrafts(userId, nextDrafts);
  }

  static async removeDraft(userId: string, draftId: string): Promise<void> {
    const drafts = (await this.getDrafts(userId)) ?? [];
    const filtered = drafts.filter((draft) => draft.id !== draftId);
    await this.setDrafts(userId, filtered);
  }

  static async getStarredEmails(
    userId: string
  ): Promise<EmailMessage[] | null> {
    const key = CACHE_KEYS.USER_STARRED(userId);
    const cached = await redis.get(key);
    return this.parseJson<EmailMessage[]>(cached);
  }

  static async setStarredEmails(
    userId: string,
    emails: EmailMessage[]
  ): Promise<void> {
    const key = CACHE_KEYS.USER_STARRED(userId);
    await this.setJson(key, CACHE_TTL.MAIL, emails);
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
    const baseKeys = [
      CACHE_KEYS.USER_THREADS(userId),
      CACHE_KEYS.USER_DRAFTS(userId),
      CACHE_KEYS.USER_STARRED(userId),
      CACHE_KEYS.USER_PRESENCE(userId),
      CACHE_KEYS.USER_TOKENS(userId),
    ];

    const detailPattern = `${CACHE_KEYS.USER_THREAD_DETAIL_PREFIX(userId)}*`;
    const detailKeys = await redis.keys(detailPattern);

    const keysToDelete = [...baseKeys, ...detailKeys];
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }
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
        console.warn(`Cleaning up cache for offline user: ${userId}`);
        await this.clearUserCache(userId);
      }
    }
  }
}

export default redis;
