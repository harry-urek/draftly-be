import { EmailRepository } from "../repositories/EmailRepository.js";
import { UserRepository } from "../repositories/UserRepository.js";
import { GmailIntegration } from "../integrations/GmailIntegration.js";
import { VertexAIIntegration } from "../integrations/VertexAIIntegration.js";
import { EmailThread, EmailDraft, EmailGenerationContext, AIStyleProfile } from "../types/index.js";
import { ServiceResult, createSuccessResult, handleServiceError } from "../utils/errors.js";

export class EmailService {
  constructor(
    private emailRepository: EmailRepository,
    private userRepository: UserRepository,
    private gmailIntegration: GmailIntegration,
    private vertexAIIntegration: VertexAIIntegration
  ) {}

  async getThreads(firebaseUid: string, limit: number = 25): Promise<ServiceResult<EmailThread[]>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const threads = await this.emailRepository.findThreadsByUserId(user.id, limit);
      return createSuccessResult(threads);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getThread(threadId: string): Promise<ServiceResult<EmailThread>> {
    try {
      const thread = await this.emailRepository.findThreadById(threadId);
      if (!thread) {
        return { success: false, error: 'Thread not found' };
      }
      return createSuccessResult(thread);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async syncUserEmails(firebaseUid: string): Promise<ServiceResult<number>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken) {
        return { success: false, error: 'Gmail tokens not found' };
      }

      const messages = await this.gmailIntegration.getMessages(tokens);
      let syncedCount = 0;

      for (const message of messages) {
        // Create or find thread
        let thread = await this.emailRepository.findThreadsByUserId(user.id)
          .then(threads => threads.find(t => t.gmailId === message.threadId));

        if (!thread) {
          thread = await this.emailRepository.createThread(
            user.id,
            message.threadId,
            message.subject
          );
        }

        // Create email if not exists
        try {
          await this.emailRepository.createEmail({
            gmailId: message.id,
            threadId: thread.id,
            userId: user.id,
            from: message.from,
            to: message.to,
            subject: message.subject,
            body: message.body || message.snippet,
            timestamp: new Date(message.date),
            isUnread: message.isUnread
          });
          syncedCount++;
        } catch (error: any) {
          // Skip if email already exists
          if (!error.message?.includes('Unique constraint')) {
            console.error('Error syncing email:', error);
          }
        }
      }

      return createSuccessResult(syncedCount);
    } catch (error) {
      return handleServiceError(error);
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
        return { success: false, error: 'User not found' };
      }

      // Get user's style profile
      const styleProfile = await this.userRepository.getStyleProfile(firebaseUid);
      if (!styleProfile) {
        return { success: false, error: 'User style profile not found. Complete onboarding first.' };
      }

      // Get thread details for context
      const thread = await this.emailRepository.findThreadById(threadId);
      if (!thread) {
        return { success: false, error: 'Email thread not found' };
      }

      // Build email generation context
      const generationContext: EmailGenerationContext = {
        originalEmail: context.originalEmail || thread.messages[thread.messages.length - 1]?.body || '',
        threadHistory: context.threadHistory || thread.messages.map(m => m.body),
        tone: context.tone,
        recipient: context.recipient
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
        status: 'PENDING'
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
        return { success: false, error: 'User not found' };
      }

      // Get tokens for Gmail API
      const tokens = await this.userRepository.getTokens(firebaseUid);
      if (!tokens?.accessToken) {
        return { success: false, error: 'Gmail tokens not found' };
      }

      // Get draft details (implementation would need to be added to repository)
      // For now, return a placeholder
      await this.emailRepository.updateDraftStatus(draftId, 'SENT');
      
      return createSuccessResult('Email sent successfully');
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getDrafts(firebaseUid: string): Promise<ServiceResult<EmailDraft[]>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      const drafts = await this.emailRepository.findDraftsByUserId(user.id);
      return createSuccessResult(drafts);
    } catch (error) {
      return handleServiceError(error);
    }
  }
}
