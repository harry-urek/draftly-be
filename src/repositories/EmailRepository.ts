import {
  PrismaClient,
  Email as EmailModel,
  Thread as ThreadModel,
  Draft as DraftModel,
} from "@prisma/client";

// eslint-disable-next-line import/no-unresolved
import { EmailMessage, EmailThread, EmailDraft } from "../types/index.js";

type ThreadWithEmails = ThreadModel & { emails: EmailModel[] };
type ThreadPreview = ThreadModel & { emails: EmailModel[] };

export class EmailRepository {
  constructor(private prisma: PrismaClient) {}

  async findThreadById(id: string): Promise<EmailThread | null> {
    const thread = await this.prisma.thread.findUnique({
      where: { id },
      include: {
        emails: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    return thread ? this.mapToEmailThread(thread as ThreadWithEmails) : null;
  }

  async findThreadsByUserId(
    userId: string,
    limit: number = 25
  ): Promise<EmailThread[]> {
    const threads = await this.prisma.thread.findMany({
      where: { userId },
      include: {
        emails: {
          orderBy: { timestamp: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return threads.map((thread: ThreadModel & { emails: EmailModel[] }) =>
      this.mapToEmailThread(thread as ThreadPreview)
    );
  }

  async findThreadByGmailId(
    userId: string,
    gmailId: string
  ): Promise<EmailThread | null> {
    const thread = await this.prisma.thread.findFirst({
      where: { userId, gmailId },
      include: {
        emails: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    return thread ? this.mapToEmailThread(thread as ThreadWithEmails) : null;
  }

  async createThread(
    userId: string,
    gmailId: string,
    subject: string
  ): Promise<EmailThread> {
    const thread = await this.prisma.thread.create({
      data: {
        userId,
        gmailId,
        subject,
      },
      include: {
        emails: {
          orderBy: { timestamp: "asc" },
        },
      },
    });

    return this.mapToEmailThread(thread as ThreadWithEmails);
  }

  async ensureThread(
    userId: string,
    gmailId: string,
    subject: string
  ): Promise<EmailThread> {
    const existing = await this.findThreadByGmailId(userId, gmailId);
    if (existing) {
      return existing;
    }
    return this.createThread(userId, gmailId, subject);
  }

  async createEmail(
    emailData: Omit<EmailMessage, "id"> & {
      userId: string;
      threadId: string;
      gmailId?: string;
    }
  ): Promise<EmailMessage> {
    const record = await this.prisma.email.create({
      data: {
        gmailId: emailData.gmailId ?? "",
        threadId: emailData.threadId,
        userId: emailData.userId,
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        htmlBody: emailData.htmlBody,
        timestamp: emailData.timestamp,
        isUnread: emailData.isUnread,
      },
    });

    return this.mapToEmailMessage(record);
  }

  async upsertEmail(
    emailData: Omit<EmailMessage, "id"> & {
      userId: string;
      threadId: string;
      gmailId: string;
    }
  ): Promise<{ email: EmailMessage; created: boolean }> {
    const existing = await this.prisma.email.findUnique({
      where: { gmailId: emailData.gmailId },
    });

    let record: EmailModel;
    let created = false;

    if (existing) {
      record = await this.prisma.email.update({
        where: { gmailId: emailData.gmailId },
        data: {
          threadId: emailData.threadId,
          userId: emailData.userId,
          from: emailData.from,
          to: emailData.to,
          subject: emailData.subject,
          body: emailData.body,
          htmlBody: emailData.htmlBody,
          timestamp: emailData.timestamp,
          isUnread: emailData.isUnread,
        },
      });
    } else {
      record = await this.prisma.email.create({
        data: {
          gmailId: emailData.gmailId,
          threadId: emailData.threadId,
          userId: emailData.userId,
          from: emailData.from,
          to: emailData.to,
          subject: emailData.subject,
          body: emailData.body,
          htmlBody: emailData.htmlBody,
          timestamp: emailData.timestamp,
          isUnread: emailData.isUnread,
        },
      });
      created = true;
    }

    return { email: this.mapToEmailMessage(record), created };
  }

  async markAsRead(emailId: string): Promise<void> {
    await this.prisma.email.update({
      where: { id: emailId },
      data: { isUnread: false },
    });
  }

  async createDraft(
    draftData: Omit<EmailDraft, "id" | "createdAt" | "updatedAt"> & {
      userId: string;
    }
  ): Promise<EmailDraft> {
    const record = await this.prisma.draft.create({
      data: {
        threadId: draftData.threadId,
        userId: draftData.userId,
        content: draftData.content,
        tone: draftData.tone,
        status: (draftData.status ?? "PENDING") as DraftModel["status"],
      },
    });

    return this.mapToEmailDraft(record);
  }

  async updateDraftStatus(
    draftId: string,
    status: DraftModel["status"]
  ): Promise<void> {
    await this.prisma.draft.update({
      where: { id: draftId },
      data: {
        status,
        ...(status === "SENT" && { sentAt: new Date() }),
      },
    });
  }

  async findDraftsByUserId(userId: string): Promise<EmailDraft[]> {
    const drafts = await this.prisma.draft.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return drafts.map((draft: DraftModel) => this.mapToEmailDraft(draft));
  }

  private mapToEmailMessage(record: EmailModel): EmailMessage {
    return {
      id: record.id,
      gmailId: record.gmailId,
      threadId: record.threadId,
      from: record.from,
      to: record.to,
      subject: record.subject,
      body: record.body,
      htmlBody: record.htmlBody ?? undefined,
      timestamp: new Date(record.timestamp),
      isUnread: record.isUnread,
    };
  }

  private mapToEmailThread(
    record: ThreadModel & { emails?: EmailModel[] }
  ): EmailThread {
    const emails = (record.emails ?? []).map((email: EmailModel) =>
      this.mapToEmailMessage(email)
    );

    // Ensure chronological order
    emails.sort(
      (a: EmailMessage, b: EmailMessage) =>
        a.timestamp.getTime() - b.timestamp.getTime()
    );

    return {
      id: record.id,
      gmailId: record.gmailId,
      subject: record.subject,
      messages: emails,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  private mapToEmailDraft(record: DraftModel): EmailDraft {
    return {
      id: record.id,
      threadId: record.threadId,
      content: record.content,
      tone: record.tone ?? undefined,
      status: record.status as EmailDraft["status"],
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }
}
