import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  registerUser,
  getUserProfile,
  storeUserTokens,
  setUserOffline,
} from "../lib/user.js";
import {
  getAuthUrl,
  getTokensFromCode,
  syncUserMessages,
} from "../lib/gmail.js";
import { prisma } from "../lib/prisma.js";

export default async function authRoutes(fastify: FastifyInstance) {
  // Blueprint Section 1.3 & 2.1: User registration
  fastify.post("/register", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      // Step 1: Create user record in database (Blueprint Section 2.1)
      const profile = await registerUser({
        firebaseUid: user.firebaseUid,
        email: user.email,
        name: user.name,
        picture: user.picture,
      });

      // Step 2: Check if user has Gmail tokens
      const hasGmailTokens = profile.accessToken && profile.refreshToken;

      if (!hasGmailTokens) {
        // User needs to authorize Gmail access via OAuth redirect
        return reply.status(201).send({
          userId: profile.firebaseUid,
          status: "registered",
          needsGmailAuth: true,
        });
      }

      // User already has tokens, trigger sync
      syncUserMessages(user.firebaseUid).catch((err) =>
        console.error("Initial sync failed:", err)
      );

      return reply.status(201).send({
        userId: profile.firebaseUid,
        status: "registered",
        needsGmailAuth: false,
      });
    } catch (error) {
      console.error("Registration error:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
      return reply.status(500).send({
        error: "Failed to register user",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get current user profile
  // Profile endpoint: GET /auth/me
  fastify.get("/me", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const profile = await getUserProfile(user.firebaseUid);

      if (!profile) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send({
        user: {
          id: profile.firebaseUid,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          accessToken: profile.accessToken ? "present" : undefined,
        },
      });
    } catch (error) {
      console.error("Get profile error:", error);
      return reply.status(500).send({
        error: "Failed to get user profile",
      });
    }
  });

  // Start Google OAuth flow for Gmail access
  fastify.get("/oauth/google/start", async (request, reply) => {
    try {
      const { state } = request.query as { state: string };
      const oauth2Client = require("../lib/gmail.js").createOAuth2Client();

      const authUrl = getAuthUrl(oauth2Client);

      // Add state parameter to track user
      const urlWithState = `${authUrl}&state=${state}`;
      reply.redirect(urlWithState);
    } catch (error) {
      console.error("Failed to start Google OAuth flow:", error);
      reply.status(500).send({ error: "Failed to start auth flow" });
    }
  });

  // Handle Google OAuth callback (Blueprint Section 2.2)
  fastify.get("/oauth/google/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state: string };

    try {
      console.log("OAuth callback received for user:", state);

      // Exchange authorization code for tokens
      const { access_token, refresh_token } = await getTokensFromCode(code);
      console.log(
        "Tokens received - access_token:",
        !!access_token,
        "refresh_token:",
        !!refresh_token
      );

      // The 'state' parameter contains the firebaseUid
      const firebaseUid = state;

      if (!access_token) {
        throw new Error("Access token not received from Google");
      }

      // Store encrypted tokens (Blueprint Section 2.2)
      await storeUserTokens(firebaseUid, {
        accessToken: access_token,
        refreshToken: refresh_token || undefined,
      });
      console.log("Tokens stored successfully for user:", firebaseUid);

      // Update onboarding status to Gmail connected
      await prisma.user.update({
        where: { firebaseUid },
        data: { onboardingStatus: "GMAIL_CONNECTED" },
      });

      // Trigger initial email sync (Blueprint Section 3.1)
      syncUserMessages(firebaseUid).catch((err) =>
        console.error("Initial sync failed after OAuth:", err)
      );

      // Redirect user to questionnaire for onboarding
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      reply.redirect(`${frontendUrl}/onboarding`);
    } catch (error) {
      console.error("Google OAuth callback error:", error);
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      reply.redirect(`${frontendUrl}?error=oauth_failed`);
    }
  });

  // Logout endpoint
  fastify.post("/session/logout", requireAuth(), async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      await setUserOffline(user.firebaseUid);

      return reply.send({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      console.error("Logout error:", error);
      return reply.status(500).send({
        error: "Logout failed",
      });
    }
  });
}
