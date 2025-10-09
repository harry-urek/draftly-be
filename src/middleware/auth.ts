import { FastifyRequest, FastifyReply } from "fastify";

import { firebaseIntegration } from "../integrations/FirebaseIntegration";
import { prisma } from "../lib/prisma";
import { slackNotifier } from "../lib/slack";
import { setUserOnline } from "../lib/user";

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

    // Update presence so background sync can see online users
    try {
      await setUserOnline(decodedToken.uid);
    } catch (e) {
      request.log?.warn({ err: e }, "Failed to update user presence");
    }
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

    // Require at least an access token. Refresh token is optional; Gmail API can still be accessed until expiry
    if (!userWithGmail || !userWithGmail.accessToken) {
      return reply.status(403).send({
        error: "Gmail authentication required",
        requiresAuth: "gmail",
      });
    }

    // Don't block based on lastActive; Gmail API calls will surface expiry. Consider enhancing with explicit expiry tracking.
  } catch (error) {
    console.error("Gmail auth middleware error:", error);
    return reply
      .status(500)
      .send({ error: "Server error during authentication" });
  }
}
