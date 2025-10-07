import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import config from "../config/index.js";
import { AuthTokens, GmailMessage } from "../types/index.js";
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

  async validateTokens(tokens: AuthTokens): Promise<boolean> {
    try {
      if (!tokens.accessToken) return false;

      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      const gmail = google.gmail({ version: "v1", auth: this.oauth2Client });
      await gmail.users.getProfile({ userId: "me" });
      return true;
    } catch (error: any) {
      if (error.code === 401 || error.code === 403) {
        return false;
      }
      throw new ExternalServiceError(
        "Gmail",
        `Token validation failed: ${error.message}`
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

  private parseGmailMessage(data: any): GmailMessage | null {
    try {
      const headers = data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || "";

      const body = this.extractBody(data.payload);

      return {
        id: data.id,
        threadId: data.threadId,
        subject: getHeader("Subject"),
        from: getHeader("From"),
        to: getHeader("To"),
        date: getHeader("Date"),
        snippet: data.snippet || "",
        body,
        isUnread: data.labelIds?.includes("UNREAD") || false,
      };
    } catch (error) {
      console.error("Error parsing Gmail message:", error);
      return null;
    }
  }

  private extractBody(payload: any): string {
    let body = "";

    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, "base64").toString("utf-8");
      return body;
    }

    if (payload.parts) {
      const htmlPart = payload.parts.find(
        (part: any) => part.mimeType === "text/html"
      );
      const textPart = payload.parts.find(
        (part: any) => part.mimeType === "text/plain"
      );
      const preferredPart = htmlPart || textPart;

      if (preferredPart?.body?.data) {
        body = Buffer.from(preferredPart.body.data, "base64").toString("utf-8");
        return body;
      }

      // Recursive search in nested parts
      for (const part of payload.parts) {
        if (part.parts) {
          const nestedBody = this.extractBody(part);
          if (nestedBody) {
            body = nestedBody;
            break;
          }
        }
      }
    }

    return body;
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
