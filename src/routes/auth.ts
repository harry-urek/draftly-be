import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import {
  registerUser,
  getUserProfile,
  storeUserTokens,
  setUserOffline,
  getUserTokensDecrypted,
} from "../lib/user.js";
import {
  getAuthUrl,
  getTokensFromCode,
  syncUserMessages,
  validateGmailTokens,
} from "../lib/gmail.js";
import { prisma } from "../lib/prisma.js";

export default async function authRoutes(fastify: FastifyInstance) {
  // Blueprint Section 1.3 & 2.1: User registration/login
  fastify.post("/register", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      // Step 1: Create or update user record in database (Blueprint Section 2.1)
      const profile = await registerUser({
        firebaseUid: user.firebaseUid,
        email: user.email,
        name: user.name,
        picture: user.picture,
      });

      // Step 2: Check if user has valid Gmail tokens
      const tokens = await getUserTokensDecrypted(user.firebaseUid);
      const hasStoredTokens = tokens?.accessToken && tokens?.refreshToken;

      // If no stored tokens, definitely need auth
      if (!hasStoredTokens) {
        return reply.status(201).send({
          userId: profile.firebaseUid,
          status: "registered",
          needsGmailAuth: true,
          onboardingStatus: profile.onboardingStatus,
        });
      }

      // If we have stored tokens, validate them by making a test API call
      const areTokensValid = await validateGmailTokens(user.firebaseUid);

      if (!areTokensValid) {
        // Stored tokens are invalid/expired - need fresh auth
        console.log(
          `Stored Gmail tokens are invalid for user ${user.firebaseUid}, requiring re-auth`
        );
        return reply.status(201).send({
          userId: profile.firebaseUid,
          status: "registered",
          needsGmailAuth: true,
          onboardingStatus: profile.onboardingStatus,
        });
      }

      // User already has valid tokens - check onboarding status
      const isNewUser =
        profile.onboardingStatus === "NOT_STARTED" ||
        profile.onboardingStatus === "GMAIL_CONNECTED";

      if (isNewUser) {
        // Returning user but needs to complete onboarding
        return reply.status(201).send({
          userId: profile.firebaseUid,
          status: "registered",
          needsGmailAuth: false,
          needsOnboarding: true,
          onboardingStatus: profile.onboardingStatus,
        });
      }

      // Existing user with completed onboarding - trigger sync and allow immediate access
      syncUserMessages(user.firebaseUid).catch((err) =>
        console.error("Background sync failed:", err)
      );

      return reply.status(200).send({
        userId: profile.firebaseUid,
        status: "authenticated",
        needsGmailAuth: false,
        needsOnboarding: false,
        onboardingStatus: profile.onboardingStatus,
      });
    } catch (error) {
      console.error("Registration/Login error:", error);
      if (error instanceof Error) {
        console.error("Error details:", error.message, error.stack);
      }
      return reply.status(500).send({
        error: "Failed to authenticate user",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get current user profile
  // Profile endpoint: GET /auth/me
  fastify.get("/me", { preHandler: requireAuth() }, async (request, reply) => {
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
          onboardingStatus: profile.onboardingStatus,
        },
      });
    } catch (error) {
      console.error("Get profile error:", error);
      return reply.status(500).send({
        error: "Failed to get user profile",
      });
    }
  });

  // Check authentication status - for returning users
  // Status endpoint: GET /auth/status
  fastify.get("/status", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const profile = await getUserProfile(user.firebaseUid);

      if (!profile) {
        return reply.status(404).send({ error: "User not found" });
      }

      // Check if user has valid Gmail tokens
      const tokens = await getUserTokensDecrypted(user.firebaseUid);
      const hasStoredTokens = tokens?.accessToken && tokens?.refreshToken;

      let hasValidGmailAuth = false;
      if (hasStoredTokens) {
        hasValidGmailAuth = await validateGmailTokens(user.firebaseUid);
      }

      const needsOnboarding =
        profile.onboardingStatus === "NOT_STARTED" ||
        profile.onboardingStatus === "GMAIL_CONNECTED";

      return reply.send({
        userId: profile.firebaseUid,
        authenticated: true,
        hasValidGmailAuth,
        needsGmailAuth: !hasValidGmailAuth,
        needsOnboarding,
        onboardingStatus: profile.onboardingStatus,
        user: {
          id: profile.firebaseUid,
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
        },
      });
    } catch (error) {
      console.error("Get auth status error:", error);
      return reply.status(500).send({
        error: "Failed to get auth status",
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
  fastify.post("/session/logout", { preHandler: requireAuth() }, async (request, reply) => {
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
