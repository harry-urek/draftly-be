import { OAuth2Client } from "google-auth-library";
import { google, gmail_v1 } from "googleapis";

// eslint-disable-next-line import/no-unresolved
import config from "../config/index";
// eslint-disable-next-line import/no-unresolved
import { AuthTokens, GmailMessage } from "../types/index.js";
// eslint-disable-next-line import/no-unresolved
import { ExternalServiceError } from "../utils/errors.js";

export class GmailIntegration {
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      config.googleClientId,
      config.googleClientSecret,
      config.googleRedirectUri
    );
  }

  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "https://mail.google.com/",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      include_granted_scopes: true,
      // Force consent to ensure a refresh_token is returned reliably.
      // Without this, some users may never receive a refresh token and will lose access when the access token expires.
      prompt: "consent",
    });
  }

  async getTokensFromCode(code: string): Promise<AuthTokens> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      return {
        accessToken: tokens.access_token || undefined,
        refreshToken: tokens.refresh_token || undefined,
      };
    } catch (error) {
      throw new ExternalServiceError(
        "Gmail OAuth",
        `Failed to exchange code for tokens: ${error}`
      );
    }
  }

  async validateTokens(
    tokens: AuthTokens
  ): Promise<{ valid: boolean; refreshedTokens?: AuthTokens }> {
    try {
      // Accept either access token or refresh token; refresh if needed
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      let refreshedTokens: AuthTokens | undefined;

      // If we only have a refresh token, attempt to get a fresh access token
      if (!tokens.accessToken && tokens.refreshToken) {
        const at = await this.oauth2Client.getAccessToken();
        if (!at || !at.token) {
          return { valid: false };
        }
        this.oauth2Client.setCredentials({
          access_token: at.token,
          refresh_token: tokens.refreshToken,
        });
        refreshedTokens = {
          accessToken: at.token,
          refreshToken: tokens.refreshToken,
        };
      }

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
      await gmail.users.getProfile({ userId: "me" });

      const latest = this.getRefreshedTokens();
      if (latest?.accessToken && latest.accessToken !== tokens.accessToken) {
        refreshedTokens = {
          accessToken: latest.accessToken,
          refreshToken: latest.refreshToken ?? tokens.refreshToken,
        };
      }

      return { valid: true, refreshedTokens };
    } catch (error: unknown) {
      const code = (error as { code?: number })?.code;
      if (code === 401 || code === 403) {
        return { valid: false };
      }
      throw new ExternalServiceError(
        "Gmail",
        `Token validation failed: ${(error as Error)?.message || String(error)}`
      );
    }
  }

  async getMessages(
    tokens: AuthTokens,
    maxResults: number = 25
  ): Promise<GmailMessage[]> {
    try {
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

      const response = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        q: "in:inbox",
      });

      const messages = response.data.messages || [];
      const detailedMessages: GmailMessage[] = [];

      for (const message of messages) {
        if (message.id) {
          const details = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
          });

          const gmailMessage = this.parseGmailMessage(details.data);
          if (gmailMessage) {
            detailedMessages.push(gmailMessage);
          }
        }
      }

      return detailedMessages;
    } catch (error) {
      throw new ExternalServiceError(
        "Gmail",
        `Failed to fetch messages: ${error}`
      );
    }
  }

  async getThreadMessages(
    tokens: AuthTokens,
    gmailThreadId: string
  ): Promise<GmailMessage[]> {
    try {
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
      const response = await gmail.users.threads.get({
        userId: "me",
        id: gmailThreadId,
        format: "full",
      });

      const threadMessages = response.data.messages || [];
      const parsed: GmailMessage[] = [];

      for (const message of threadMessages) {
        const parsedMessage = this.parseGmailMessage(message);
        if (parsedMessage) {
          parsed.push(parsedMessage);
        }
      }

      return parsed;
    } catch (error) {
      throw new ExternalServiceError(
        "Gmail",
        `Failed to fetch thread ${gmailThreadId}: ${error}`
      );
    }
  }

  async sendEmail(
    tokens: AuthTokens,
    to: string,
    subject: string,
    body: string
  ): Promise<string> {
    try {
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

      const email = [`To: ${to}`, `Subject: ${subject}`, "", body].join("\n");

      const encodedEmail = Buffer.from(email).toString("base64url");

      const result = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedEmail,
        },
      });

      return result.data.id || "";
    } catch (error) {
      throw new ExternalServiceError("Gmail", `Failed to send email: ${error}`);
    }
  }

  async sendReply(
    tokens: AuthTokens,
    options: {
      threadId: string;
      to: string;
      subject: string;
      body: string;
      inReplyTo?: string;
      references?: string[];
      cc?: string[];
      bcc?: string[];
    }
  ): Promise<string> {
    try {
      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });

      const headers: string[] = [
        `To: ${options.to}`,
        `Subject: ${options.subject}`,
      ];

      if (options.cc?.length) {
        headers.push(`Cc: ${options.cc.join(", ")}`);
      }
      if (options.bcc?.length) {
        headers.push(`Bcc: ${options.bcc.join(", ")}`);
      }
      if (options.inReplyTo) {
        headers.push(`In-Reply-To: ${options.inReplyTo}`);
      }
      if (options.references?.length) {
        headers.push(`References: ${options.references.join(" ")}`);
      }

      headers.push('Content-Type: text/html; charset="UTF-8"');
      headers.push("", options.body);

      const encodedEmail = Buffer.from(headers.join("\n")).toString(
        "base64url"
      );

      const result = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: encodedEmail,
          threadId: options.threadId,
        },
      });

      return result.data.id || "";
    } catch (error) {
      throw new ExternalServiceError("Gmail", `Failed to send reply: ${error}`);
    }
  }

  private parseGmailMessage(
    data: gmail_v1.Schema$Message
  ): GmailMessage | null {
    try {
      const headers = data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find(
          (h: gmail_v1.Schema$MessagePartHeader) =>
            (h.name ?? "").toLowerCase() === name.toLowerCase()
        )?.value || "";
      const { html, text } = this.extractBodies(data.payload);

      return {
        id: data.id || "",
        threadId: data.threadId || "",
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        snippet: data.snippet || "",
        body: text || html || data.snippet || "",
        htmlBody: html,
        isUnread: data.labelIds?.includes("UNREAD") || false,
        messageIdHeader: getHeader("Message-ID") || undefined,
        references:
          getHeader("References") || getHeader("In-Reply-To") || undefined,
      };
    } catch (error) {
      console.error("Error parsing Gmail message:", error);
      return null;
    }
  }

  private extractBodies(payload?: gmail_v1.Schema$MessagePart | null): {
    html?: string;
    text?: string;
  } {
    let html: string | undefined = undefined;
    let text: string | undefined = undefined;

    const decode = (b64: string) =>
      Buffer.from(b64, "base64").toString("utf-8");

    if (payload?.body?.data) {
      // Single-part message
      const mime = payload.mimeType || "text/plain";
      if (mime.includes("html")) html = decode(payload.body.data);
      else text = decode(payload.body.data);
      return { html, text };
    }

    const visit = (part?: gmail_v1.Schema$MessagePart | null) => {
      if (!part) return;
      if (part.mimeType?.includes("text/html") && part.body?.data && !html) {
        html = decode(part.body.data);
      }
      if (part.mimeType?.includes("text/plain") && part.body?.data && !text) {
        text = decode(part.body.data);
      }
      if (part.parts) {
        for (const p of part.parts) visit(p);
      }
    };

    if (payload?.parts) {
      for (const p of payload.parts) visit(p);
    }

    return { html, text };
  }

  getRefreshedTokens(): AuthTokens | null {
    const { credentials } = this.oauth2Client;
    if (!credentials.access_token) return null;

    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || undefined,
    };
  }
}
