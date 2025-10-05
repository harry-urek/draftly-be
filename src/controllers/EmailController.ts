import { FastifyRequest, FastifyReply } from "fastify";
import { EmailService } from "../services/EmailService.js";
import { AuthRequest } from "../types/index.js";

export interface EmailController {
  getMessages(request: AuthRequest, reply: FastifyReply): Promise<void>;
  syncMessages(request: AuthRequest, reply: FastifyReply): Promise<void>;
  refreshMessages(request: AuthRequest, reply: FastifyReply): Promise<void>;
  getMessage(request: AuthRequest, reply: FastifyReply): Promise<void>;
  generateDraft(request: AuthRequest, reply: FastifyReply): Promise<void>;
  sendEmail(request: AuthRequest, reply: FastifyReply): Promise<void>;
}

export class EmailControllerImpl implements EmailController {
  constructor(private emailService: EmailService) {}

  async getMessages(request: AuthRequest, reply: FastifyReply): Promise<void> {
    try {
      const user = request.firebaseUser!;
      const result = await this.emailService.getMessages(user.firebaseUid);

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({ messages: result.data });
    } catch (error) {
      console.error("Get messages error:", error);
      return reply.status(500).send({ error: "Failed to fetch messages" });
    }
  }

  async syncMessages(request: AuthRequest, reply: FastifyReply): Promise<void> {
    try {
      const user = request.firebaseUser!;
      const result = await this.emailService.syncMessages(user.firebaseUid);

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({ success: true, message: "Sync started" });
    } catch (error) {
      console.error("Sync messages error:", error);
      return reply.status(500).send({ error: "Failed to start sync" });
    }
  }

  async refreshMessages(request: AuthRequest, reply: FastifyReply): Promise<void> {
    try {
      const user = request.firebaseUser!;
      const result = await this.emailService.refreshMessages(user.firebaseUid);

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({ 
        messages: result.data,
        count: result.data?.length || 0 
      });
    } catch (error) {
      console.error("Refresh messages error:", error);
      return reply.status(500).send({ error: "Failed to refresh messages" });
    }
  }

  async getMessage(request: AuthRequest, reply: FastifyReply): Promise<void> {
    try {
      const { id } = request.params as { id: string };
      const user = request.firebaseUser!;

      if (!id) {
        return reply.status(400).send({ error: "Message ID is required" });
      }

      const result = await this.emailService.getMessage(user.firebaseUid, id);

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({ message: result.data });
    } catch (error) {
      console.error("Get message error:", error);
      return reply.status(500).send({ error: "Failed to fetch message" });
    }
  }

  async generateDraft(request: AuthRequest, reply: FastifyReply): Promise<void> {
    try {
      const user = request.firebaseUser!;
      const { messageId, tone } = request.body as {
        messageId: string;
        tone?: string;
      };

      if (!messageId) {
        return reply.status(400).send({ error: "Message ID is required" });
      }

      const result = await this.emailService.generateDraft(
        user.firebaseUid,
        messageId,
        tone
      );

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({ draft: result.data });
    } catch (error) {
      console.error("Generate draft error:", error);
      return reply.status(500).send({ error: "Failed to generate draft" });
    }
  }

  async sendEmail(request: AuthRequest, reply: FastifyReply): Promise<void> {
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
        return reply
          .status(400)
          .send({ error: "To, subject, and body are required" });
      }

      const result = await this.emailService.sendEmail(user.firebaseUid, {
        to,
        subject,
        body,
        threadId,
        inReplyTo,
        references,
      });

      if (!result.success) {
        return reply.status(500).send({ error: result.error });
      }

      return reply.send({
        success: true,
        messageId: result.data?.messageId,
        threadId: result.data?.threadId,
      });
    } catch (error) {
      console.error("Send email error:", error);
      return reply.status(500).send({ error: "Failed to send email" });
    }
  }
}
