import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthService } from "../services/AuthService.js";
import { requireAuth } from "../middleware/auth.js";
import config from "../config/index.js";

interface AuthController {
  registerRoutes(fastify: FastifyInstance): void;
}

export class AuthControllerImpl implements AuthController {
  constructor(private authService: AuthService) {}

  registerRoutes(fastify: FastifyInstance): void {
    // Register/Login endpoint
    fastify.post(
      "/auth/register",
      { preHandler: [requireAuth()] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = (request as any).firebaseUser!;

          const result = await this.authService.registerOrLoginUser(user);

          if (!result.success) {
            return reply.status(500).send({
              error: result.error,
            });
          }

          const {
            user: userProfile,
            needsGmailAuth,
            needsOnboarding,
          } = result.data!;

          const status =
            userProfile.onboardingStatus === "ACTIVE"
              ? "authenticated"
              : "registered";
          const statusCode = status === "authenticated" ? 200 : 201;

          return reply.status(statusCode).send({
            userId: userProfile.firebaseUid,
            status,
            needsGmailAuth,
            needsOnboarding,
            onboardingStatus: userProfile.onboardingStatus,
          });
        } catch (error) {
          console.error("Registration/Login error:", error);
          return reply.status(500).send({
            error: "Failed to authenticate user",
          });
        }
      }
    );

    // Get current user profile
    fastify.get(
      "/auth/me",
      { preHandler: [requireAuth()] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = (request as any).firebaseUser!;

          const result = await this.authService.getAuthStatus(user.firebaseUid);

          if (!result.success) {
            return reply.status(404).send({ error: result.error });
          }

          const { user: profile } = result.data!;

          return reply.send({
            user: {
              id: profile.firebaseUid,
              email: profile.email,
              name: profile.name,
              picture: profile.picture,
              onboardingStatus: profile.onboardingStatus,
            },
          });
        } catch (error) {
          console.error("Get profile error:", error);
          return reply.status(500).send({
            error: "Failed to get user profile",
          });
        }
      }
    );

    // Check authentication status
    fastify.get(
      "/auth/status",
      { preHandler: [requireAuth()] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = (request as any).firebaseUser!;

          const result = await this.authService.getAuthStatus(user.firebaseUid);

          if (!result.success) {
            return reply.status(404).send({ error: result.error });
          }

          const {
            user: profile,
            hasValidGmailAuth,
            needsOnboarding,
          } = result.data!;

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
      }
    );

    // Start Google OAuth flow
    fastify.get(
      "/auth/oauth/google/start",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { state } = request.query as { state: string };
          const authUrl = this.authService.getGmailAuthUrl();
          const urlWithState = `${authUrl}&state=${state}`;

          return reply.redirect(urlWithState);
        } catch (error) {
          console.error("Failed to start Google OAuth flow:", error);
          return reply.status(500).send({ error: "Failed to start auth flow" });
        }
      }
    );

    // Handle Google OAuth callback
    fastify.get(
      "/auth/oauth/google/callback",
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const { code, state } = request.query as {
            code: string;
            state: string;
          };

          if (!code || !state) {
            return reply
              .status(400)
              .send({ error: "Missing code or state parameter" });
          }

          const result = await this.authService.handleGmailCallback(
            code,
            state
          );

          if (!result.success) {
            const frontendUrl = config.frontendUrl;
            return reply.redirect(
              `${frontendUrl}?error=oauth_failed&message=${encodeURIComponent(
                result.error || "OAuth failed"
              )}`
            );
          }

          // Redirect to onboarding or success page
          const frontendUrl = config.frontendUrl;
          return reply.redirect(`${frontendUrl}/onboarding`);
        } catch (error) {
          console.error("Google OAuth callback error:", error);
          const frontendUrl = config.frontendUrl;
          return reply.redirect(`${frontendUrl}?error=oauth_failed`);
        }
      }
    );

    // Logout endpoint
    fastify.post(
      "/auth/logout",
      { preHandler: [requireAuth()] },
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const user = (request as any).firebaseUser!;

          const result = await this.authService.logout(user.firebaseUid);

          if (!result.success) {
            return reply.status(500).send({ error: result.error });
          }

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
      }
    );
  }
}
