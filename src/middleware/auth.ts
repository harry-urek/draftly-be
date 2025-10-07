import { FastifyRequest, FastifyReply } from "fastify";

import { firebaseIntegration } from "../integrations/FirebaseIntegration.js";
import { prisma } from "../lib/prisma.js";
import { slackNotifier } from "../lib/slack.js";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name?: string;
  picture?: string;
  firebaseUid: string;
}

declare module "fastify" {
  interface FastifyRequest {
    firebaseUser?: AuthenticatedUser;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({
        error: "Missing or invalid authorization header",
      });
    }

    const idToken = authHeader.split("Bearer ")[1];

    if (!idToken) {
      return reply.status(401).send({
        error: "Missing ID token",
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await firebaseIntegration.verifyIdToken(idToken);

    // Get user info from Firebase Auth
    const userRecord = await firebaseIntegration
      .getAdminAuth()
      .getUser(decodedToken.uid);

    // Attach user to request
    request.firebaseUser = {
      userId: decodedToken.uid,
      email: decodedToken.email || userRecord.email || "",
      name: decodedToken.name || userRecord.displayName,
      picture: decodedToken.picture || userRecord.photoURL,
      firebaseUid: decodedToken.uid,
    };

    // Also set the existing user field for backward compatibility
    request.user = {
      userId: decodedToken.uid,
      email: decodedToken.email || userRecord.email || "",
    };
  } catch (error) {
    console.error("Auth middleware error:", (error as Error).message);

    // Send authentication error notification to Slack in production
    if (process.env.NODE_ENV === "production") {
      await slackNotifier.authError(error as Error, {
        userAgent: request.headers["user-agent"],
        ip: request.ip,
        endpoint: request.url,
      });
    }

    return reply.status(401).send({
      error: "Invalid or expired token",
    });
  }
}

// Helper to require authentication on routes
export function requireAuth() {
  return authMiddleware;
}

// Enhanced middleware that checks Gmail permissions and forces re-verification
export async function requireGmailAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    // First run the standard auth check
    await authMiddleware(request, reply);

    // If headers were sent, auth check failed
    if (reply.sent) return;

    const user = request.firebaseUser;
    if (!user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    // Check if user has valid Gmail credentials
    const userWithGmail = await prisma.user.findUnique({
      where: { firebaseUid: user.firebaseUid },
      select: {
        accessToken: true,
        refreshToken: true,
        lastActive: true,
      },
    });

    if (
      !userWithGmail ||
      !userWithGmail.accessToken ||
      !userWithGmail.refreshToken
    ) {
      return reply.status(403).send({
        error: "Gmail authentication required",
        requiresAuth: "gmail",
      });
    }

    // Since we don't have a token expiry field in the schema,
    // we'll use lastActive as a proxy for the token's freshness
    // For a more robust solution, consider adding a tokenExpiry field to the User model
    const lastActiveTime = userWithGmail.lastActive.getTime();

    // If user hasn't been active in the last 6 hours, ask for token refresh
    // This is a simplified check since we don't have actual token expiry tracking
    if (Date.now() - lastActiveTime > 6 * 60 * 60 * 1000) {
      return reply.status(403).send({
        error: "Gmail token may be expired",
        requiresAuth: "gmail",
      });
    }
  } catch (error) {
    console.error("Gmail auth middleware error:", error);
    return reply
      .status(500)
      .send({ error: "Server error during authentication" });
  }
}
