/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest, FastifyReply } from "fastify";

import { EmailService } from "../services/EmailService";

export class EmailController {
  constructor(private emailService: EmailService) {}

  async getMessages(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const result = await this.emailService.getThreads(
        request.firebaseUser.firebaseUid
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({
        success: true,
        data: result.data,
      });
    } catch (error: any) {
      console.error("Error getting messages:", error);
      reply.code(500).send({
        error: "Failed to get messages",
      });
    }
  }

  async getDrafts(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const result = await this.emailService.getDrafts(
        request.firebaseUser.firebaseUid
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({ success: true, data: result.data });
    } catch (error: any) {
      console.error("Error getting drafts:", error);
      reply.code(500).send({ error: "Failed to get drafts" });
    }
  }

  async sendNewEmail(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { to, subject, body } = request.body as {
        to: string;
        subject: string;
        body: string; // HTML body
      };

      if (!to || !subject || !body) {
        reply.code(400).send({ error: "to, subject and body are required" });
        return;
      }

      const result = await this.emailService.sendNewEmail(
        request.firebaseUser.firebaseUid,
        to,
        subject,
        body
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({ success: true, data: { messageId: result.data } });
    } catch (error: any) {
      console.error("Error sending email:", error);
      reply.code(500).send({ error: "Failed to send email" });
    }
  }

  async syncMessages(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const result = await this.emailService.syncUserEmails(
        request.firebaseUser.firebaseUid
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({
        success: true,
        data: {
          synced: result.data?.synced ?? 0,
          errors: result.data?.errors ?? 0,
          errorDetails:
            result.data && result.data.errorDetails.length > 0
              ? result.data.errorDetails
              : null,
        },
      });
    } catch (error: any) {
      console.error("Error syncing messages:", error);
      reply.code(500).send({
        error: "Failed to sync messages",
      });
    }
  }

  async refreshMessages(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      // First sync new messages
      const syncResult = await this.emailService.syncUserEmails(
        request.firebaseUser.firebaseUid
      );

      if (!syncResult.success) {
        reply.code(400).send({ error: syncResult.error });
        return;
      }

      // Then get latest threads
      const threadsResult = await this.emailService.getThreads(
        request.firebaseUser.firebaseUid
      );

      if (!threadsResult.success) {
        reply.code(400).send({ error: threadsResult.error });
        return;
      }

      reply.send({
        success: true,
        data: threadsResult.data,
      });
    } catch (error: any) {
      console.error("Error refreshing messages:", error);
      reply.code(500).send({
        error: "Failed to refresh messages",
      });
    }
  }

  async getMessage(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { id } = request.params as { id: string };

      if (!id) {
        reply.code(400).send({ error: "Thread ID is required" });
        return;
      }

      const result = await this.emailService.getThread(
        request.firebaseUser.firebaseUid,
        id
      );

      const payload = result.data;

      if (!result.success) {
        if (payload?.thread) {
          reply.code(207).send({
            success: false,
            error: result.error,
            data: payload.thread,
            upsertErrors: payload.upsertErrors ?? [],
          });
          return;
        }

        reply.code(404).send({ error: result.error || "Thread not found" });
        return;
      }

      // Also return any cached suggested reply for this thread
      const suggested = await this.emailService.getSuggestedReply(
        request.firebaseUser.firebaseUid,
        id
      );

      reply.send({
        success: true,
        data: payload?.thread,
        suggestedReply: suggested.success ? suggested.data : null,
        upsertErrors: payload?.upsertErrors ?? [],
      });
    } catch (error: any) {
      console.error("Error getting message:", error);
      reply.code(500).send({
        error: "Failed to get message",
      });
    }
  }

  async generateDraft(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { threadId, context } = request.body as {
        threadId: string;
        context: any;
      };

      if (!threadId) {
        reply.code(400).send({ error: "Thread ID is required" });
        return;
      }

      const result = await this.emailService.generateDraft(
        request.firebaseUser.firebaseUid,
        threadId,
        context
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({
        success: true,
        data: result.data,
      });
    } catch (error: any) {
      console.error("Error generating draft:", error);
      reply.code(500).send({
        error: "Failed to generate draft",
      });
    }
  }

  async sendEmail(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { draftId } = request.body as { draftId: string };

      if (!draftId) {
        reply.code(400).send({
          error: "Draft ID is required",
        });
        return;
      }

      const result = await this.emailService.sendDraft(
        request.firebaseUser.firebaseUid,
        draftId
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({
        success: true,
        data: {
          message: result.data,
          sentAt: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error("Error sending email:", error);
      reply.code(500).send({
        error: "Failed to send email",
      });
    }
  }

  async replyToMessage(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { id } = request.params as { id: string };
      const { body } = request.body as { body: string };

      if (!id) {
        reply.code(400).send({ error: "Thread ID is required" });
        return;
      }

      if (!body || !body.trim()) {
        reply.code(400).send({ error: "Reply body is required" });
        return;
      }

      const result = await this.emailService.replyToThread(
        request.firebaseUser.firebaseUid,
        id,
        body.trim()
      );

      const payload = result.data;

      if (!result.success) {
        if (payload?.thread) {
          reply.code(207).send({
            success: false,
            error: result.error,
            data: payload.thread,
            upsertErrors: payload.upsertErrors ?? [],
          });
          return;
        }

        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({
        success: true,
        data: payload?.thread,
        upsertErrors: payload?.upsertErrors ?? [],
      });
    } catch (error: any) {
      console.error("Error replying to message:", error);
      reply.code(500).send({
        error: "Failed to send reply",
      });
    }
  }

  // New: trigger suggested reply generation (cache-only, background)
  async generateSuggested(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { threadId, context } = request.body as {
        threadId: string;
        context?: any;
      };

      if (!threadId) {
        reply.code(400).send({ error: "Thread ID is required" });
        return;
      }

      // Fire-and-forget
      void this.emailService.generateAndCacheSuggestedReply(
        request.firebaseUser.firebaseUid,
        threadId,
        context
      );

      reply.send({ success: true, status: "started" });
    } catch (error: any) {
      console.error("Error generating suggested reply:", error);
      reply.code(500).send({ error: "Failed to generate suggested reply" });
    }
  }

  // New: fetch cached suggested reply
  async getSuggested(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { id } = request.params as { id: string };
      if (!id) {
        reply.code(400).send({ error: "Thread ID is required" });
        return;
      }

      const result = await this.emailService.getSuggestedReply(
        request.firebaseUser.firebaseUid,
        id
      );

      if (!result.success) {
        reply.code(400).send({ error: result.error });
        return;
      }

      reply.send({ success: true, data: result.data });
    } catch (error: any) {
      console.error("Error getting suggested reply:", error);
      reply.code(500).send({ error: "Failed to fetch suggested reply" });
    }
  }
}
