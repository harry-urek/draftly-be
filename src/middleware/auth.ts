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
