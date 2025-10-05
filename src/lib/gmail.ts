import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "./prisma.js";
import redis from "./cache.js";
import { slackNotifier } from "./slack.js";
import { getUserTokensDecrypted } from "./user.js";

const SCOPES = [
  "https://mail.google.com/",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  body?: string;
  isUnread: boolean;
}

// Helper function to extract email body from Gmail message payload
function extractBody(payload: any): string {
  let body = "";

  // Check if body is in payload.body.data (single part message)
  if (payload.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return body;
  }

  // Check if message has parts (multipart message)
  if (payload.parts) {
    // Try to find text/html first, fall back to text/plain
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

    // If still no body, check for nested parts (multipart/alternative, etc.)
    for (const part of payload.parts) {
      if (part.parts) {
        const nestedBody = extractBody(part);
        if (nestedBody) {
          return nestedBody;
        }
      }
    }
  }

  return body;
}

export function createOAuth2Client(): OAuth2Client {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function getAuthUrl(oauth2Client: OAuth2Client): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function getTokensFromCode(code: string) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getGmailClient(accessToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function getUserInfo(accessToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();

  return data;
}

/**
 * Validates if stored Gmail tokens are still valid by making a test API call
 * @param firebaseUid - User's Firebase UID
 * @returns true if tokens are valid and working, false otherwise
 */
export async function validateGmailTokens(
  firebaseUid: string
): Promise<boolean> {
  try {
    const tokens = await getUserTokensDecrypted(firebaseUid);
    if (!tokens?.accessToken) {
      return false;
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    // Make a simple test call to verify token validity
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    await gmail.users.getProfile({ userId: "me" });

    // If the call succeeds, tokens are valid
    return true;
  } catch (error: any) {
    // If we get authentication errors, tokens are invalid
    if (error.code === 401 || error.code === 403) {
      console.log(
        `Invalid Gmail tokens for user ${firebaseUid}: ${error.message}`
      );
      return false;
    }

    // For other errors, assume tokens might be valid but there's a temporary issue
    console.warn(
      `Error validating Gmail tokens for user ${firebaseUid}:`,
      error.message
    );
    return false;
  }
}

export async function getGmailMessages(
  firebaseUid: string,
  maxResults: number = 25
): Promise<GmailMessage[]> {
  try {
    // Get user's decrypted tokens
    const tokens = await getUserTokensDecrypted(firebaseUid);
    const accessToken = tokens?.accessToken;
    const refreshToken = tokens?.refreshToken;

    if (!accessToken && !refreshToken) {
      // No tokens available
      console.warn(
        `No Gmail tokens stored for user ${firebaseUid}. User needs to authorize Gmail access.`
      );
      return [];
    }

    // Build OAuth client with both tokens so google-auth-library can auto-refresh
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Fetch messages from inbox
    const response = await gmail.users.messages.list({
      userId: "me",
      maxResults,
      q: "in:inbox",
    });

    const messages = response.data.messages || [];

    // Persist refreshed access token if library obtained a new one
    const latestAccessToken = (oauth2Client.credentials as any)?.access_token;
    const latestRefreshToken = (oauth2Client.credentials as any)?.refresh_token;
    if (latestAccessToken && latestAccessToken !== accessToken) {
      try {
        await (
          await import("./user.js")
        ).storeUserTokens(firebaseUid, {
          accessToken: latestAccessToken,
          // Google usually won't rotate refresh token, but store if present
          refreshToken: latestRefreshToken ?? undefined,
        });
      } catch (e) {
        console.warn("Failed to persist refreshed access token:", e);
      }
    }
    const formattedMessages: GmailMessage[] = [];

    // Get details for each message
    for (const message of messages) {
      try {
        const messageDetail = await gmail.users.messages.get({
          userId: "me",
          id: message.id!,
          format: "full",
        });

        const headers = messageDetail.data.payload?.headers || [];
        const subject =
          headers.find((h) => h.name === "Subject")?.value || "No Subject";
        const from = headers.find((h) => h.name === "From")?.value || "Unknown";
        const to = headers.find((h) => h.name === "To")?.value || "";
        const date =
          headers.find((h) => h.name === "Date")?.value ||
          new Date().toISOString();

        const isUnread =
          messageDetail.data.labelIds?.includes("UNREAD") || false;

        // Extract body from payload
        const body = extractBody(messageDetail.data.payload);

        formattedMessages.push({
          id: message.id!,
          threadId: messageDetail.data.threadId || "",
          subject,
          from,
          to,
          date,
          snippet: messageDetail.data.snippet || "",
          body: body || messageDetail.data.snippet || "",
          isUnread,
        });
      } catch (error) {
        console.error(`Error fetching message ${message.id}:`, error);
      }
    }

    return formattedMessages;
  } catch (error) {
    console.error("Error fetching Gmail messages:", error);

    // If unauthorized and we have a refresh token, suggest re-auth
    const message = (error as any)?.message || "";
    if (
      /unauthorized|UNAUTHENTICATED|invalid authentication credentials|invalid_grant/i.test(
        message
      )
    ) {
      console.warn(
        "Gmail API unauthorized. If this persists, the user may need to re-connect Gmail to obtain a new refresh token."
      );
    }

    // Check if it's a quota exceeded error
    const errorMessage = (error as any)?.message || "";
    if (
      errorMessage.includes("quota") ||
      errorMessage.includes("Quota exceeded")
    ) {
      if (process.env.NODE_ENV === "production") {
        await slackNotifier.gmailQuotaExceeded(firebaseUid, error as Error);
      }
    }

    throw error;
  }
}

export async function syncUserMessages(firebaseUid: string): Promise<void> {
  try {
    console.log(`Starting sync for user ${firebaseUid}`);

    // Fetch latest 25 messages
    const messages = await getGmailMessages(firebaseUid, 25);

    // Cache the messages
    const cacheKey = `user:${firebaseUid}:inbox`;
    await redis.setex(cacheKey, 600, JSON.stringify(messages)); // Cache for 10 minutes

    // Publish update to SSE subscribers
    const updateChannel = `user:${firebaseUid}:updates`;
    await redis.publish(
      updateChannel,
      JSON.stringify({
        type: "inbox_updated",
        timestamp: new Date().toISOString(),
        messageCount: messages.length,
      })
    );

    console.log(`Synced ${messages.length} messages for user ${firebaseUid}`);
  } catch (error) {
    console.error(`Error syncing messages for user ${firebaseUid}:`, error);

    // Check if it's a quota exceeded error
    const errorMessage = (error as any)?.message || "";
    if (
      errorMessage.includes("quota") ||
      errorMessage.includes("Quota exceeded")
    ) {
      if (process.env.NODE_ENV === "production") {
        await slackNotifier.gmailQuotaExceeded(firebaseUid, error as Error);
      }
    }

    // Don't throw the error to prevent breaking the application
    // Just log it and continue
  }
}

/**
 * Send an email reply using Gmail API
 * @param firebaseUid - User's Firebase UID
 * @param replyData - Email reply data
 * @returns Sent message information
 */
export async function sendEmailReply(
  firebaseUid: string,
  replyData: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  }
): Promise<{ messageId: string; threadId: string }> {
  try {
    // Get user's decrypted tokens
    const tokens = await getUserTokensDecrypted(firebaseUid);
    const accessToken = tokens?.accessToken;
    const refreshToken = tokens?.refreshToken;

    if (!accessToken && !refreshToken) {
      throw new Error("No Gmail tokens available for user");
    }

    // Build OAuth client
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Get user's email address
    const profile = await gmail.users.getProfile({ userId: "me" });
    const userEmail = profile.data.emailAddress;

    // Prepare email headers
    let emailContent = `From: ${userEmail}\r\n`;
    emailContent += `To: ${replyData.to}\r\n`;
    emailContent += `Subject: ${replyData.subject}\r\n`;

    if (replyData.inReplyTo) {
      emailContent += `In-Reply-To: ${replyData.inReplyTo}\r\n`;
    }

    if (replyData.references) {
      emailContent += `References: ${replyData.references}\r\n`;
    }

    emailContent += `Content-Type: text/html; charset=utf-8\r\n`;
    emailContent += `\r\n`;
    emailContent += replyData.body;

    // Encode the email content
    const encodedMessage = Buffer.from(emailContent)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Send the email
    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId: replyData.threadId,
      },
    });

    console.log(`[Gmail] Email sent successfully for user ${firebaseUid}`);

    return {
      messageId: response.data.id!,
      threadId: response.data.threadId!,
    };
  } catch (error) {
    console.error("[Gmail] Failed to send email reply:", error);
    throw new Error("Failed to send email reply");
  }
}

/**
 * Get a single Gmail message by ID
 * @param firebaseUid - User's Firebase UID
 * @param msgId - Gmail message ID
 * @returns Gmail message details
 */
export async function getGmailMessage(
  firebaseUid: string,
  msgId: string
): Promise<GmailMessage & { messageId: string }> {
  try {
    // Get user's decrypted tokens
    const tokens = await getUserTokensDecrypted(firebaseUid);
    const accessToken = tokens?.accessToken;
    const refreshToken = tokens?.refreshToken;

    if (!accessToken && !refreshToken) {
      throw new Error("No Gmail tokens available for user");
    }

    // Build OAuth client
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Get message details
    const messageDetail: any = await gmail.users.messages.get({
      userId: "me",
      id: msgId,
      format: "full",
    });

    const headers: any[] = messageDetail.data.payload?.headers || [];
    const subject =
      headers.find((h: any) => h.name === "Subject")?.value || "No Subject";
    const from =
      headers.find((h: any) => h.name === "From")?.value || "Unknown";
    const to = headers.find((h: any) => h.name === "To")?.value || "";
    const date =
      headers.find((h: any) => h.name === "Date")?.value ||
      new Date().toISOString();
    const messageIdHeader: string =
      headers.find((h: any) => h.name === "Message-ID")?.value || "";

    const isUnread = messageDetail.data.labelIds?.includes("UNREAD") || false;

    // Extract body from payload
    const body = extractBody(messageDetail.data.payload);

    return {
      id: messageDetail.data.id!,
      threadId: messageDetail.data.threadId || "",
      subject,
      from,
      to,
      date,
      snippet: messageDetail.data.snippet || "",
      body,
      isUnread,
      messageId: messageIdHeader, // Add Message-ID for threading
    };
  } catch (error) {
    console.error(`[Gmail] Failed to get message ${msgId}:`, error);
    throw new Error("Failed to get message");
  }
}
