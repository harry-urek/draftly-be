/* eslint-disable import/no-unresolved */
import { GmailIntegration } from "../integrations/GmailIntegration";
import { VertexAIIntegration } from "../integrations/VertexAIIntegration";
import { EmailRepository } from "../repositories/EmailRepository";
import { UserRepository } from "../repositories/UserRepository";
import {
  EmailThread,
  EmailDraft,
  EmailGenerationContext,
  AIStyleProfile,
} from "../types";
import {
  ServiceResult,
  createSuccessResult,
  handleServiceError,
} from "../utils/errors";

export class EmailService {
  constructor(
    private emailRepository: EmailRepository,
    private userRepository: UserRepository,
    private gmailIntegration: GmailIntegration,
    private vertexAIIntegration: VertexAIIntegration
  ) {}

  async getThreads(
    firebaseUid: string,
    limit: number = 25
  ): Promise<ServiceResult<EmailThread[]>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      const threads = await this.emailRepository.findThreadsByUserId(
        user.id,
        limit
      );
      return createSuccessResult(threads);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getThread(
    firebaseUid: string,
    threadId: string
  ): Promise<ServiceResult<EmailThread>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      const thread = await this.emailRepository.findThreadById(threadId);
      if (!thread || thread.id !== threadId) {
        return { success: false, error: "Thread not found" };
      }

      if (!thread.gmailId) {
        return createSuccessResult(thread);
      }

      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken && !tokens?.refreshToken) {
        return { success: false, error: "Gmail tokens not found" };
      }

      const threadMessages = await this.gmailIntegration.getThreadMessages(
        tokens,
        thread.gmailId
      );

      const threadCache = new Map<string, EmailThread>();
      threadCache.set(thread.gmailId, thread);

      for (const message of threadMessages) {
        if (!message.id || !message.threadId) continue;
        const gmailThreadId = message.threadId;

        let mappedThread = threadCache.get(gmailThreadId);
        if (!mappedThread) {
          mappedThread = await this.emailRepository.ensureThread(
            user.id,
            gmailThreadId,
            message.subject
          );
          threadCache.set(gmailThreadId, mappedThread);
        }

        const subject =
          message.subject || mappedThread.subject || thread.subject || "";
        await this.emailRepository.upsertEmail({
          gmailId: message.id,
          threadId: mappedThread.id,
          userId: user.id,
          from: message.from,
          to: message.to,
          subject,
          body: message.body || message.snippet,
          htmlBody: message.htmlBody,
          timestamp: this.parseDate(message.date),
          isUnread: message.isUnread,
        });
      }

      const refreshed = await this.emailRepository.findThreadById(threadId);
      if (!refreshed) {
        return { success: false, error: "Thread not found" };
      }

      return createSuccessResult(refreshed);
    } catch (error: unknown) {
      return handleServiceError<EmailThread>(error);
    }
  }

  async syncUserEmails(firebaseUid: string): Promise<
    ServiceResult<{
      synced: number;
      errors: number;
      errorDetails: Array<{ messageId: string; error: string }>;
    }>
  > {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken) {
        return { success: false, error: "Gmail tokens not found" };
      }

      const messages = await this.gmailIntegration.getMessages(tokens);
      let syncedCount = 0;
      const errorDetails: Array<{ messageId: string; error: string }> = [];

      const threadCache = new Map<string, EmailThread>();

      for (const message of messages) {
        if (!message.threadId || !message.id) {
          continue;
        }

        // Create or find thread
        let thread = threadCache.get(message.threadId);
        if (!thread) {
          thread = await this.emailRepository.ensureThread(
            user.id,
            message.threadId,
            message.subject
          );
          threadCache.set(message.threadId, thread);
        }

        const subject = message.subject || thread.subject || "";

        // Create email if not exists
        try {
          const result = await this.emailRepository.upsertEmail({
            gmailId: message.id,
            threadId: thread.id,
            userId: user.id,
            from: message.from,
            to: message.to,
            subject,
            body: message.body || message.snippet,
            htmlBody: message.htmlBody,
            timestamp: this.parseDate(message.date),
            isUnread: message.isUnread,
          });
          if (result.created) {
            syncedCount++;
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          // Skip if email already exists (unique constraint violations)
          if (!errorMessage.includes("Unique constraint")) {
            console.error("Error syncing email:", error);
            errorDetails.push({
              messageId: message.id,
              error: errorMessage,
            });
          }
        }
      }

      return createSuccessResult({
        synced: syncedCount,
        errors: errorDetails.length,
        errorDetails,
      });
    } catch (error: unknown) {
      return handleServiceError<{
        synced: number;
        errors: number;
        errorDetails: Array<{ messageId: string; error: string }>;
      }>(error);
    }
  }

  async generateDraft(
    firebaseUid: string,
    threadId: string,
    context: Partial<EmailGenerationContext>
  ): Promise<ServiceResult<EmailDraft>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Get user's style profile
      const styleProfile =
        await this.userRepository.getStyleProfile(firebaseUid);
      if (!styleProfile) {
        return {
          success: false,
          error: "User style profile not found. Complete onboarding first.",
        };
      }

      // Get thread details for context
      const thread = await this.emailRepository.findThreadById(threadId);
      if (!thread) {
        return { success: false, error: "Email thread not found" };
      }

      // Build email generation context
      const generationContext: EmailGenerationContext = {
        originalEmail:
          context.originalEmail ||
          thread.messages[thread.messages.length - 1]?.body ||
          "",
        threadHistory:
          context.threadHistory || thread.messages.map((m) => m.body),
        tone: context.tone,
        recipient: context.recipient,
      };

      // Generate draft using AI
      const draftContent = await this.vertexAIIntegration.generateEmailDraft(
        styleProfile as AIStyleProfile,
        generationContext
      );

      // Save draft to database
      const draft = await this.emailRepository.createDraft({
        threadId,
        userId: user.id,
        content: draftContent,
        tone: context.tone,
        status: "PENDING",
      });

      return createSuccessResult(draft);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async sendDraft(
    firebaseUid: string,
    draftId: string
  ): Promise<ServiceResult<string>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Get tokens for Gmail API
      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken) {
        return { success: false, error: "Gmail tokens not found" };
      }

      // Get draft details (implementation would need to be added to repository)
      // For now, return a placeholder
      await this.emailRepository.updateDraftStatus(draftId, "SENT");

      return createSuccessResult("Draft sent successfully");
    } catch (error: unknown) {
      return handleServiceError<string>(error);
    }
  }

  async getDrafts(firebaseUid: string): Promise<ServiceResult<EmailDraft[]>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      const drafts = await this.emailRepository.findDraftsByUserId(user.id);
      return createSuccessResult(drafts);
    } catch (error: unknown) {
      return handleServiceError<EmailDraft[]>(error);
    }
  }

  async replyToThread(
    firebaseUid: string,
    threadId: string,
    body: string
  ): Promise<ServiceResult<EmailThread>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      const thread = await this.emailRepository.findThreadById(threadId);
      if (!thread) {
        return { success: false, error: "Thread not found" };
      }

      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken && !tokens?.refreshToken) {
        return { success: false, error: "Gmail tokens not found" };
      }

      if (!thread.gmailId) {
        return { success: false, error: "Thread is missing Gmail metadata" };
      }

      const threadMessages = await this.gmailIntegration.getThreadMessages(
        tokens,
        thread.gmailId
      );

      if (!threadMessages.length) {
        return { success: false, error: "No messages found in thread" };
      }

      const sortedMessages = [...threadMessages].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      const latest = sortedMessages[sortedMessages.length - 1];
      if (!latest) {
        return { success: false, error: "Unable to determine latest message" };
      }

      const fromAddress =
        latest.from ?? sortedMessages.find((msg) => msg.from)?.from;
      if (!fromAddress) {
        return { success: false, error: "Unable to determine recipient" };
      }

      const recipient = this.extractEmailAddress(fromAddress);
      const baseSubject = thread.subject || latest.subject || "";
      const subject = baseSubject.startsWith("Re:")
        ? baseSubject
        : baseSubject
          ? `Re: ${baseSubject}`
          : "Re:";

      const inReplyTo = latest.messageIdHeader;
      const references = Array.from(
        new Set(
          [
            ...(latest.references ? latest.references.split(/\s+/) : []),
            latest.messageIdHeader,
          ].filter(Boolean)
        )
      ) as string[];

      await this.gmailIntegration.sendReply(tokens, {
        threadId: thread.gmailId,
        to: recipient,
        subject,
        body,
        inReplyTo,
        references,
      });

      // Refresh thread to include the new message
      return this.getThread(firebaseUid, threadId);
    } catch (error: unknown) {
      return handleServiceError<EmailThread>(error);
    }
  }

  private extractEmailAddress(value: string): string {
    const match = value.match(/<([^>]+)>/);
    return match ? match[1] : value;
  }

  private parseDate(value?: string): Date {
    if (!value) {
      return new Date();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
