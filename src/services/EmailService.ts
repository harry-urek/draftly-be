/* eslint-disable import/no-unresolved */
import { GmailIntegration } from "../integrations/GmailIntegration";
import { VertexAIIntegration } from "../integrations/VertexAIIntegration";
import {
  EmailBatchUpsertResult,
  EmailRepository,
  EmailUpsertInput,
} from "../repositories/EmailRepository";
import { UserRepository } from "../repositories/UserRepository";
import {
  EmailThread,
  EmailDraft,
  EmailGenerationContext,
  AIStyleProfile,
  User,
  AuthTokens,
} from "../types";
import {
  ServiceResult,
  createErrorResult,
  createSuccessResult,
  handleServiceError,
} from "../utils/errors";

type ThreadPayload = {
  thread: EmailThread;
  upsertErrors?: Array<{ gmailId: string; error: string }>;
};

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
    return this.executeWithUser<EmailThread[]>(
      firebaseUid,
      async ({ user }: { user: User }) => {
        const threads = await this.emailRepository.findThreadsByUserId(
          user.id,
          limit
        );
        return createSuccessResult(threads);
      }
    );
  }

  async getThread(
    firebaseUid: string,
    threadId: string
  ): Promise<ServiceResult<ThreadPayload>> {
    return this.executeWithUser<ThreadPayload>(
      firebaseUid,
      async ({ user }: { user: User }) => {
        const thread = await this.emailRepository.findThreadById(threadId);
        if (!thread || thread.id !== threadId) {
          return createErrorResult<ThreadPayload>("Thread not found");
        }

        if (!thread.gmailId) {
          return createSuccessResult({ thread });
        }

        const tokens = await this.getValidTokens(firebaseUid, "any");
        if (!tokens) {
          return createErrorResult<ThreadPayload>("Gmail tokens not found");
        }

        const threadMessages = await this.gmailIntegration.getThreadMessages(
          tokens,
          thread.gmailId
        );

        const threadCache = new Map<string, EmailThread>();
        threadCache.set(thread.gmailId, thread);

        const emailPayloads: EmailUpsertInput[] = [];

        for (const message of threadMessages) {
          if (!message.id || !message.threadId) continue;

          let mappedThread = threadCache.get(message.threadId);
          if (!mappedThread) {
            mappedThread = await this.emailRepository.ensureThread(
              user.id,
              message.threadId,
              message.subject
            );
            threadCache.set(message.threadId, mappedThread);
          }

          const subject =
            message.subject || mappedThread.subject || thread.subject || "";

          emailPayloads.push({
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

        let upsertReport: EmailBatchUpsertResult = {
          results: [],
          createdCount: 0,
          errors: [],
        };

        if (emailPayloads.length > 0) {
          upsertReport =
            await this.emailRepository.upsertEmailsBatch(emailPayloads);
        }

        const refreshed = await this.emailRepository.findThreadById(threadId);
        if (!refreshed) {
          return createErrorResult<ThreadPayload>("Thread not found");
        }

        if (upsertReport.errors.length > 0) {
          return {
            success: false,
            error: "Some emails failed to upsert",
            data: {
              thread: refreshed,
              upsertErrors: upsertReport.errors,
            },
          };
        }

        return createSuccessResult({ thread: refreshed });
      }
    );
  }

  async syncUserEmails(firebaseUid: string): Promise<
    ServiceResult<{
      synced: number;
      errors: number;
      errorDetails: Array<{ messageId: string; error: string }>;
    }>
  > {
    return this.executeWithUserAndTokens<{
      synced: number;
      errors: number;
      errorDetails: Array<{ messageId: string; error: string }>;
    }>(
      firebaseUid,
      "access",
      async ({ user, tokens }: { user: User; tokens: AuthTokens }) => {
        const messages = await this.gmailIntegration.getMessages(tokens);
        const threadCache = new Map<string, EmailThread>();
        const emailPayloads: EmailUpsertInput[] = [];

        for (const message of messages) {
          if (!message.threadId || !message.id) {
            continue;
          }

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

          emailPayloads.push({
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
        }

        const upsertReport =
          await this.emailRepository.upsertEmailsBatch(emailPayloads);

        const errorDetails = upsertReport.errors.map((error) => ({
          messageId: error.gmailId,
          error: error.error,
        }));

        return createSuccessResult({
          synced: upsertReport.createdCount,
          errors: errorDetails.length,
          errorDetails,
        });
      }
    );
  }

  async generateDraft(
    firebaseUid: string,
    threadId: string,
    context: Partial<EmailGenerationContext>
  ): Promise<ServiceResult<EmailDraft>> {
    return this.executeWithUser<EmailDraft>(
      firebaseUid,
      async ({ user }: { user: User }) => {
        const styleProfile =
          await this.userRepository.getStyleProfile(firebaseUid);
        if (!styleProfile) {
          return createErrorResult<EmailDraft>(
            "User style profile not found. Complete onboarding first."
          );
        }

        const thread = await this.emailRepository.findThreadById(threadId);
        if (!thread) {
          return createErrorResult<EmailDraft>("Email thread not found");
        }

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

        const draftContent = await this.vertexAIIntegration.generateEmailDraft(
          styleProfile as AIStyleProfile,
          generationContext
        );

        const draft = await this.emailRepository.createDraft({
          threadId,
          userId: user.id,
          content: draftContent,
          tone: context.tone,
          status: "PENDING",
        });

        return createSuccessResult(draft);
      }
    );
  }

  async sendDraft(
    firebaseUid: string,
    draftId: string
  ): Promise<ServiceResult<string>> {
    return this.executeWithUserAndTokens<string>(
      firebaseUid,
      "access",
      async ({ tokens }: { user: User; tokens: AuthTokens }) => {
        void tokens;
        await this.emailRepository.updateDraftStatus(draftId, "SENT");
        return createSuccessResult("Draft sent successfully");
      }
    );
  }

  async getDrafts(firebaseUid: string): Promise<ServiceResult<EmailDraft[]>> {
    return this.executeWithUser<EmailDraft[]>(
      firebaseUid,
      async ({ user }: { user: User }) => {
        const drafts = await this.emailRepository.findDraftsByUserId(user.id);
        return createSuccessResult(drafts);
      }
    );
  }

  async replyToThread(
    firebaseUid: string,
    threadId: string,
    body: string
  ): Promise<ServiceResult<ThreadPayload>> {
    return this.executeWithUserAndTokens<ThreadPayload>(
      firebaseUid,
      "any",
      async ({ tokens }: { user: User; tokens: AuthTokens }) => {
        const thread = await this.emailRepository.findThreadById(threadId);
        if (!thread) {
          return createErrorResult<ThreadPayload>("Thread not found");
        }

        if (!thread.gmailId) {
          return createErrorResult<ThreadPayload>(
            "Thread is missing Gmail metadata"
          );
        }

        const threadMessages = await this.gmailIntegration.getThreadMessages(
          tokens,
          thread.gmailId
        );

        if (!threadMessages.length) {
          return createErrorResult<ThreadPayload>(
            "No messages found in thread"
          );
        }

        const sortedMessages = [...threadMessages].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        const latest = sortedMessages[sortedMessages.length - 1];
        if (!latest) {
          return createErrorResult<ThreadPayload>(
            "Unable to determine latest message"
          );
        }

        const fromAddress =
          latest.from ?? sortedMessages.find((msg) => msg.from)?.from;
        if (!fromAddress) {
          return createErrorResult<ThreadPayload>(
            "Unable to determine recipient"
          );
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

        return this.getThread(firebaseUid, threadId);
      }
    );
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

  private async executeWithUser<T>(
    firebaseUid: string,
    action: (context: { user: User }) => Promise<ServiceResult<T>>
  ): Promise<ServiceResult<T>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return createErrorResult<T>("User not found");
      }
      return await action({ user });
    } catch (error) {
      return handleServiceError<T>(error);
    }
  }

  private async executeWithUserAndTokens<T>(
    firebaseUid: string,
    requirement: "any" | "access",
    action: (context: {
      user: User;
      tokens: AuthTokens;
    }) => Promise<ServiceResult<T>>
  ): Promise<ServiceResult<T>> {
    return this.executeWithUser(firebaseUid, async ({ user }) => {
      const tokens = await this.getValidTokens(firebaseUid, requirement);
      if (!tokens) {
        return createErrorResult<T>("Gmail tokens not found");
      }
      return action({ user, tokens });
    });
  }

  private async getValidTokens(
    firebaseUid: string,
    requirement: "any" | "access"
  ): Promise<AuthTokens | null> {
    const tokens = await this.userRepository.getTokens(firebaseUid);
    if (!tokens) {
      return null;
    }

    const hasAccess = Boolean(tokens.accessToken);
    const hasRefresh = Boolean(tokens.refreshToken);

    if (requirement === "access") {
      return hasAccess ? tokens : null;
    }

    return hasAccess || hasRefresh ? tokens : null;
  }
}
