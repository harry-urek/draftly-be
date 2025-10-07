/**
 * @deprecated This file is deprecated and will be removed soon.
 * Please use the EmailController class in src/controllers/EmailController.ts instead.
 * The new implementation follows the layered architecture pattern.
 */

import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  getGmailMessages,
  syncUserMessages,
  getGmailMessage,
  sendEmailReply,
} from "../lib/gmail.js";
import { generateEmailDraft } from "../lib/vertexai.js";
import { prisma } from "../lib/prisma.js";
import redis from "../lib/cache.js";

export default async function emailRoutes(fastify: FastifyInstance) {
  // Get inbox messages
  fastify.get("/mail/messages", { preHandler: requireAuth() }, async (request, reply) => {
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
  fastify.post("/mail/sync", { preHandler: requireAuth() }, async (request, reply) => {
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
  fastify.get("/mail/refresh", { preHandler: requireAuth() }, async (request, reply) => {
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
  fastify.get("/mail/messages/:id", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.firebaseUser!;

      const message = await getGmailMessage(user.firebaseUid, id);

      return reply.send({ message });
    } catch (error) {
      console.error("Get message error:", error);
      return reply.status(500).send({
        error: "Failed to fetch message",
      });
    }
  });

  // Generate email draft using AI
  fastify.post("/mail/draft", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const { messageId, tone } = request.body as {
        messageId: string;
        tone?: string;
      };

      if (!messageId) {
        return reply.status(400).send({
          error: "Message ID is required",
        });
      }

      // Get the original message
      const originalMessage = await getGmailMessage(
        user.firebaseUid,
        messageId
      );

      // Get user's style profile from database
      const userRecord = await prisma.user.findUnique({
        where: { firebaseUid: user.firebaseUid },
      });

      const styleProfile = userRecord?.aiStyleProfile;

      if (!styleProfile) {
        return reply.status(400).send({
          error:
            "User style profile not found. Please complete onboarding first.",
        });
      }

      // Generate draft using Vertex AI
      const draft = await generateEmailDraft(styleProfile, {
        originalEmail: originalMessage.body || originalMessage.snippet,
        tone,
      });

      return reply.send({
        draft,
        originalMessage: {
          id: originalMessage.id,
          subject: originalMessage.subject,
          from: originalMessage.from,
          threadId: originalMessage.threadId,
        },
      });
    } catch (error) {
      console.error("Draft generation error:", error);
      return reply.status(500).send({
        error: "Failed to generate email draft",
      });
    }
  });

  // Send email reply
  fastify.post("/mail/send", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const { to, subject, body, threadId, inReplyTo, references } =
        request.body as {
          to: string;
          subject: string;
          body: string;
          threadId?: string;
          inReplyTo?: string;
          references?: string;
        };

      if (!to || !subject || !body) {
        return reply.status(400).send({
          error: "To, subject, and body are required",
        });
      }

      // Send the email
      const result = await sendEmailReply(user.firebaseUid, {
        to,
        subject,
        body,
        threadId,
        inReplyTo,
        references,
      });

      // Clear inbox cache to trigger refresh
      const cacheKey = `user:${user.firebaseUid}:inbox`;
      await redis.del(cacheKey);

      return reply.send({
        success: true,
        messageId: result.messageId,
        threadId: result.threadId,
      });
    } catch (error) {
      console.error("Send email error:", error);
      return reply.status(500).send({
        error: "Failed to send email",
      });
    }
  });
}
