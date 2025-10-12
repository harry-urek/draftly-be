/* eslint-disable import/no-unresolved */
import { GmailIntegration } from "../integrations/GmailIntegration";
import { CacheManager } from "../lib/cache";
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
      onboardingStatus: User["onboardingStatus"];
      redirectToInbox: boolean;
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

      const needsGmailAuth = !tokens?.accessToken && !tokens?.refreshToken;

      // Check onboarding status
      const needsOnboarding =
        user.onboardingStatus === "NOT_STARTED" ||
        user.onboardingStatus === "GMAIL_CONNECTED";

      const redirectToInbox =
        user.onboardingStatus === "COMPLETED_INIT_PROFILE";

      return createSuccessResult({
        user,
        needsGmailAuth,
        needsOnboarding,
        onboardingStatus: user.onboardingStatus,
        redirectToInbox,
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
      redirectToInbox: boolean;
    }>
  > {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check Gmail tokens
      const tokens = await this.userRepository.getTokens(firebaseUid);

      const hasValidGmailAuth = Boolean(
        tokens?.accessToken || tokens?.refreshToken
      );

      const needsOnboarding =
        user.onboardingStatus === "NOT_STARTED" ||
        user.onboardingStatus === "GMAIL_CONNECTED";

      const redirectToInbox =
        user.onboardingStatus === "COMPLETED_INIT_PROFILE";

      return createSuccessResult({
        user,
        hasValidGmailAuth,
        needsOnboarding,
        redirectToInbox,
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
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: "User not found" };
      }

      await this.userRepository.setOffline(firebaseUid);
      await CacheManager.clearUserCache(user.id);
      return createSuccessResult(undefined);
    } catch (error) {
      return handleServiceError(error);
    }
  }
}
