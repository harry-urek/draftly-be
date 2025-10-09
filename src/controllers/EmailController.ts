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
        data: { synced: result.data, errors: 0 },
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

      const result = await this.emailService.getThread(id);

      if (!result.success) {
        reply.code(404).send({ error: result.error || "Thread not found" });
        return;
      }

      reply.send({
        success: true,
        data: result.data,
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
        context || {}
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
}
