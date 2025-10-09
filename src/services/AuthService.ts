import { GmailIntegration } from "../integrations/GmailIntegration";
import { UserRepository } from "../repositories/UserRepository";
import { User, FirebaseUser } from "../types";
import {
  ServiceResult,
  createSuccessResult,
  handleServiceError,
} from "../utils/errors";

export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private gmailIntegration: GmailIntegration
  ) {}

  async registerOrLoginUser(firebaseUser: FirebaseUser): Promise<
    ServiceResult<{
      user: User;
      needsGmailAuth: boolean;
      needsOnboarding: boolean;
    }>
  > {
    try {
      // Check if user exists
      let user = await this.userRepository.findByFirebaseUid(
        firebaseUser.firebaseUid
      );

      if (!user) {
        // Create new user
        user = await this.userRepository.create({
          firebaseUid: firebaseUser.firebaseUid,
          email: firebaseUser.email,
          name: firebaseUser.name,
          picture: firebaseUser.picture,
          onboardingStatus: "NOT_STARTED",
        });
      } else {
        // Update existing user info and last active
        user = await this.userRepository.update(firebaseUser.firebaseUid, {
          name: firebaseUser.name,
          picture: firebaseUser.picture,
        });
        await this.userRepository.updateLastActive(firebaseUser.firebaseUid);
      }

      // Check Gmail authentication status
      const tokens = await this.userRepository.getTokens(
        firebaseUser.firebaseUid
      );
      // Treat presence of an access token as potentially valid; refresh token is optional
      const hasAccessToken = Boolean(tokens?.accessToken);

      let needsGmailAuth = true;
      if (hasAccessToken) {
        // Validate by hitting Gmail API; if it works, we don't need Gmail auth
        const safeTokens = {
          accessToken: tokens?.accessToken,
          refreshToken: tokens?.refreshToken,
        };
        const validation =
          await this.gmailIntegration.validateTokens(safeTokens);
        needsGmailAuth = !validation.valid;

        if (validation.refreshedTokens?.accessToken && validation.valid) {
          await this.userRepository.storeTokens(
            firebaseUser.firebaseUid,
            validation.refreshedTokens
          );
        }
      }

      // Check onboarding status
      const needsOnboarding =
        user.onboardingStatus === "NOT_STARTED" ||
        user.onboardingStatus === "GMAIL_CONNECTED";

      return createSuccessResult({
        user,
        needsGmailAuth,
        needsOnboarding,
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getAuthStatus(firebaseUid: string): Promise<
    ServiceResult<{
      user: User;
      hasValidGmailAuth: boolean;
      needsOnboarding: boolean;
    }>
  > {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check Gmail tokens
      const tokens = await this.userRepository.getTokens(firebaseUid);
      // Access token alone is acceptable; validate when present
      const hasAccessToken = Boolean(tokens?.accessToken);

      let hasValidGmailAuth = false;
      if (hasAccessToken) {
        const safeTokens = {
          accessToken: tokens?.accessToken,
          refreshToken: tokens?.refreshToken,
        };
        const validation =
          await this.gmailIntegration.validateTokens(safeTokens);
        hasValidGmailAuth = validation.valid;

        if (validation.refreshedTokens?.accessToken && validation.valid) {
          await this.userRepository.storeTokens(
            firebaseUid,
            validation.refreshedTokens
          );
        }
      }

      const needsOnboarding =
        user.onboardingStatus === "NOT_STARTED" ||
        user.onboardingStatus === "GMAIL_CONNECTED";

      return createSuccessResult({
        user,
        hasValidGmailAuth,
        needsOnboarding,
      });
    } catch (error) {
      return handleServiceError(error);
    }
  }

  getGmailAuthUrl(): string {
    return this.gmailIntegration.getAuthUrl();
  }

  async handleGmailCallback(
    code: string,
    firebaseUid: string
  ): Promise<ServiceResult<void>> {
    try {
      const tokens = await this.gmailIntegration.getTokensFromCode(code);

      if (!tokens.accessToken) {
        return { success: false, error: "Failed to obtain access token" };
      }

      await this.userRepository.storeTokens(firebaseUid, tokens);
      await this.userRepository.updateOnboardingStatus(
        firebaseUid,
        "GMAIL_CONNECTED"
      );

      return createSuccessResult(undefined);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async logout(firebaseUid: string): Promise<ServiceResult<void>> {
    try {
      await this.userRepository.setOffline(firebaseUid);
      await this.userRepository.clearTokens(firebaseUid);
      await this.userRepository.purgeUserData(firebaseUid);
      return createSuccessResult(undefined);
    } catch (error) {
      return handleServiceError(error);
    }
  }
}
