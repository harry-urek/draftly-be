import { google } from "googleapis";
import { getUserTokensDecrypted } from "./user.js";
import redis from "./cache.js";

interface EmailForStyleLearning {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  timestamp: string;
}

/**
 * Fetch recent sent and inbox emails for onboarding style learning
 * This runs in the background while user completes questionnaire
 */
export async function fetchRecentEmailsForStyleLearning(
  firebaseUid: string,
  options: { sentCount: number; inboxCount: number }
) {
  console.log(`[Gmail] Fetching style learning emails for: ${firebaseUid}`);

  try {
    const tokens = await getUserTokensDecrypted(firebaseUid);
    if (!tokens) {
      throw new Error("No Gmail tokens found");
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Fetch sent emails (user's writing samples)
    const sentResponse = await gmail.users.messages.list({
      userId: "me",
      q: "in:sent",
      maxResults: options.sentCount,
    });

    const sentEmails: EmailForStyleLearning[] = [];
    if (sentResponse.data.messages) {
      for (const msg of sentResponse.data.messages) {
        try {
          const fullMsg = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "full",
          });

          const headers = fullMsg.data.payload?.headers || [];
          const subject =
            headers.find((h) => h.name === "Subject")?.value || "(no subject)";
          const from = headers.find((h) => h.name === "From")?.value || "";
          const to = headers.find((h) => h.name === "To")?.value || "";
          const date = headers.find((h) => h.name === "Date")?.value || "";

          // Extract body
          const body = extractEmailBody(fullMsg.data.payload);

          sentEmails.push({
            id: msg.id!,
            threadId: msg.threadId!,
            subject,
            from,
            to,
            body,
            timestamp: date,
          });
        } catch (err) {
          console.error(`Failed to fetch sent email ${msg.id}:`, err);
        }
      }
    }

    // Fetch inbox emails (context for replies)
    const inboxResponse = await gmail.users.messages.list({
      userId: "me",
      q: "in:inbox",
      maxResults: options.inboxCount,
    });

    const inboxEmails: EmailForStyleLearning[] = [];
    if (inboxResponse.data.messages) {
      for (const msg of inboxResponse.data.messages) {
        try {
          const fullMsg = await gmail.users.messages.get({
            userId: "me",
            id: msg.id!,
            format: "full",
          });

          const headers = fullMsg.data.payload?.headers || [];
          const subject =
            headers.find((h) => h.name === "Subject")?.value || "(no subject)";
          const from = headers.find((h) => h.name === "From")?.value || "";
          const to = headers.find((h) => h.name === "To")?.value || "";
          const date = headers.find((h) => h.name === "Date")?.value || "";

          const body = extractEmailBody(fullMsg.data.payload);

          inboxEmails.push({
            id: msg.id!,
            threadId: msg.threadId!,
            subject,
            from,
            to,
            body,
            timestamp: date,
          });
        } catch (err) {
          console.error(`Failed to fetch inbox email ${msg.id}:`, err);
        }
      }
    }

    console.log(
      `[Gmail] Fetched ${sentEmails.length} sent, ${inboxEmails.length} inbox emails`
    );

    return { sentEmails, inboxEmails };
  } catch (error) {
    console.error("[Gmail] Failed to fetch style learning emails:", error);
    throw error;
  }
}

// Extract body from Gmail message payload
function extractEmailBody(payload: any): string {
  let body = "";

  if (payload.body?.data) {
    body = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return body;
  }

  if (payload.parts) {
    const textPart = payload.parts.find(
      (part: any) => part.mimeType === "text/plain"
    );
    const htmlPart = payload.parts.find(
      (part: any) => part.mimeType === "text/html"
    );

    const preferredPart = textPart || htmlPart;

    if (preferredPart?.body?.data) {
      body = Buffer.from(preferredPart.body.data, "base64").toString("utf-8");
    }
  }

  return body || "(no content)";
}

/**
 * Cache user's emails for onboarding in Redis
 * TTL: 1 hour (enough time for questionnaire + profile generation)
 */
export async function cacheUserEmailsForOnboarding(
  firebaseUid: string,
  emails: {
    sentEmails: EmailForStyleLearning[];
    inboxEmails: EmailForStyleLearning[];
  }
) {
  const cacheKey = `onboarding:emails:${firebaseUid}`;
  const TTL = 3600; // 1 hour

  try {
    await redis.setex(cacheKey, TTL, JSON.stringify(emails));
    console.log(`[Cache] Stored onboarding emails for: ${firebaseUid}`);
  } catch (error) {
    console.error("[Cache] Failed to cache onboarding emails:", error);
    throw error;
  }
}

/**
 * Retrieve cached onboarding emails from Redis
 */
export async function getCachedOnboardingEmails(firebaseUid: string): Promise<{
  sentEmails: EmailForStyleLearning[];
  inboxEmails: EmailForStyleLearning[];
} | null> {
  const cacheKey = `onboarding:emails:${firebaseUid}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    console.error("[Cache] Failed to retrieve cached emails:", error);
    return null;
  }
}
