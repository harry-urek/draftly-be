import { FastifyRequest, FastifyReply } from "fastify";
import { auth, verifyFirebaseToken } from "../lib/firebase.js";
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
    const decodedToken = await verifyFirebaseToken(idToken);

    // Get user info from Firebase Auth
    const userRecord = await auth.getUser(decodedToken.uid);

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

    // Security enhancement: Log every authenticated request for audit purposes
    console.log(`[AUTH] Authenticated request from user: ${decodedToken.uid} to ${request.url}`);
    
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
  return {
    preHandler: authMiddleware,
  };
}

// Enhanced middleware that checks Gmail permissions and forces re-verification
export async function requireGmailAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // First run standard auth middleware
  await authMiddleware(request, reply);
  
  if (reply.sent) {
    return; // Auth failed, response already sent
  }

  try {
    const user = request.firebaseUser!;
    
    // Import getUserProfile here to avoid circular dependency
    const { getUserProfile } = await import("../lib/user.js");
    const profile = await getUserProfile(user.firebaseUid);

    if (!profile) {
      return reply.status(404).send({ error: "User not found" });
    }

    // Check if user has valid Gmail tokens
    const hasValidTokens = profile.accessToken && profile.refreshToken;

    if (!hasValidTokens) {
      return reply.status(403).send({
        error: "Gmail authorization required",
        message: "Please re-verify Gmail permissions to access this feature",
        needsGmailAuth: true,
      });
    }

    console.log(`[AUTH] Gmail permissions verified for user: ${user.firebaseUid}`);
    
  } catch (error) {
    console.error("Gmail auth check error:", (error as Error).message);
    return reply.status(500).send({
      error: "Failed to verify Gmail permissions",
    });
  }
}

// Helper to require both authentication and Gmail permissions
export function requireGmailPermissions() {
  return {
    preHandler: requireGmailAuth,
  };
}
