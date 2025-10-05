import { PrismaClient } from "@prisma/client";
import { EmailMessage, EmailThread, EmailDraft } from "../types/index.js";

export class EmailRepository {
  constructor(private prisma: PrismaClient) {}

  async findThreadById(id: string): Promise<EmailThread | null> {
    const thread = await this.prisma.thread.findUnique({
      where: { id },
      include: {
        emails: {
          orderBy: { timestamp: 'asc' }
        }
      }
    });
    return thread ? this.mapToEmailThread(thread) : null;
  }

  async findThreadsByUserId(userId: string, limit: number = 25): Promise<EmailThread[]> {
    const threads = await this.prisma.thread.findMany({
      where: { userId },
      include: {
        emails: {
          orderBy: { timestamp: 'desc' },
          take: 1 // Get latest email for preview
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: limit
    });
    return threads.map(thread => this.mapToEmailThread(thread));
  }

  async createThread(userId: string, gmailId: string, subject: string): Promise<EmailThread> {
    const thread = await this.prisma.thread.create({
      data: {
        userId,
        gmailId,
        subject
      },
      include: {
        emails: true
      }
    });
    return this.mapToEmailThread(thread);
  }

  async createEmail(emailData: Omit<EmailMessage, 'id'> & { userId: string; threadId: string; gmailId?: string }): Promise<EmailMessage> {
    const email = await this.prisma.email.create({
      data: {
        gmailId: emailData.gmailId || '',
        threadId: emailData.threadId,
        userId: emailData.userId,
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        htmlBody: emailData.htmlBody,
        timestamp: emailData.timestamp,
        isUnread: emailData.isUnread
      }
    });
    return this.mapToEmailMessage(email);
  }

  async markAsRead(emailId: string): Promise<void> {
    await this.prisma.email.update({
      where: { id: emailId },
      data: { isUnread: false }
    });
  }

  async createDraft(draftData: Omit<EmailDraft, 'id' | 'createdAt' | 'updatedAt'> & { userId: string }): Promise<EmailDraft> {
    const draft = await this.prisma.draft.create({
      data: {
        threadId: draftData.threadId,
        userId: draftData.userId,
        content: draftData.content,
        tone: draftData.tone,
        status: (draftData.status as any) || 'PENDING'
      }
    });
    return this.mapToEmailDraft(draft);
  }

  async updateDraftStatus(draftId: string, status: string): Promise<void> {
    await this.prisma.draft.update({
      where: { id: draftId },
      data: { 
        status: status as any,
        ...(status === 'SENT' && { sentAt: new Date() })
      }
    });
  }

  async findDraftsByUserId(userId: string): Promise<EmailDraft[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    return drafts.map(draft => this.mapToEmailDraft(draft));
  }

  private mapToEmailMessage(dbEmail: any): EmailMessage {
    return {
      id: dbEmail.id,
      threadId: dbEmail.threadId,
      from: dbEmail.from,
      to: dbEmail.to,
      subject: dbEmail.subject,
      body: dbEmail.body,
      htmlBody: dbEmail.htmlBody,
      timestamp: new Date(dbEmail.timestamp),
      isUnread: dbEmail.isUnread
    };
  }

  private mapToEmailThread(dbThread: any): EmailThread {
    return {
      id: dbThread.id,
      gmailId: dbThread.gmailId,
      subject: dbThread.subject,
      messages: dbThread.emails?.map((email: any) => this.mapToEmailMessage(email)) || [],
      createdAt: new Date(dbThread.createdAt),
      updatedAt: new Date(dbThread.updatedAt)
    };
  }

  private mapToEmailDraft(dbDraft: any): EmailDraft {
    return {
      id: dbDraft.id,
      threadId: dbDraft.threadId,
      content: dbDraft.content,
      tone: dbDraft.tone,
      status: dbDraft.status,
      createdAt: new Date(dbDraft.createdAt),
      updatedAt: new Date(dbDraft.updatedAt)
    };
  }
}
