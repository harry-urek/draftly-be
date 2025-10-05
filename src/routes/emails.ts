import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { getGmailMessages, syncUserMessages } from "../lib/gmail.js";
import redis from "../lib/cache.js";

export default async function emailRoutes(fastify: FastifyInstance) {
  // Get inbox messages
  fastify.get("/mail/messages", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const cacheKey = `user:${user.firebaseUid}:inbox`;
      const cachedMessages = await redis.get(cacheKey);

      if (cachedMessages) {
        return reply.send({
          messages: JSON.parse(cachedMessages),
        });
      }

      // If cache is empty, trigger a background sync and return an empty array
      syncUserMessages(user.firebaseUid).catch((err: Error) =>
        console.error("Initial background sync error:", err)
      );

      reply.header("X-Sync-Status", "started");
      return reply.send({ messages: [] });
    } catch (error) {
      console.error("Inbox fetch error:", error);
      return reply.status(500).send({
        error: "Failed to fetch inbox messages",
      });
    }
  });

  // Force sync messages from Gmail (triggered by refresh)
  fastify.post("/mail/sync", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      // Start background sync
      syncUserMessages(user.firebaseUid).catch((err: Error) =>
        console.error("Background sync error:", err)
      );

      return reply.send({
        success: true,
        message: "Sync started",
      });
    } catch (error) {
      console.error("Sync trigger error:", error);
      return reply.status(500).send({
        error: "Failed to start sync",
      });
    }
  });

  // Force refresh - immediately fetch fresh messages from Gmail
  fastify.get("/mail/refresh", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      // Fetch fresh messages directly from Gmail (bypass cache)
      const messages = await getGmailMessages(user.firebaseUid, 25);

      // Update cache with fresh messages
      const cacheKey = `user:${user.firebaseUid}:inbox`;
      await redis.setex(cacheKey, 600, JSON.stringify(messages)); // Cache for 10 minutes

      return reply.send({
        messages,
        count: messages.length,
      });
    } catch (error) {
      console.error("Refresh error:", error);
      return reply.status(500).send({
        error: "Failed to refresh inbox",
      });
    }
  });

  // Get a single email message by ID
  fastify.get("/mail/messages/:id", requireAuth(), async (request, reply) => {
    // Implementation for fetching a single message can be added here
    return reply.status(501).send({ error: "Not implemented" });
  });
}
