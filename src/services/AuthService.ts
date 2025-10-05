import { UserRepository } from "../repositories/UserRepository.js";
import { GmailIntegration } from "../integrations/GmailIntegration.js";
import { User, AuthTokens, FirebaseUser } from "../types/index.js";
import {
  ServiceResult,
  createSuccessResult,
  handleServiceError,
} from "../utils/errors.js";

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
      const hasValidTokens = tokens?.accessToken && tokens?.refreshToken;

      let needsGmailAuth = true;
      if (hasValidTokens) {
        needsGmailAuth = !(await this.gmailIntegration.validateTokens(tokens));
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
      const hasValidTokens = tokens?.accessToken && tokens?.refreshToken;

      let hasValidGmailAuth = false;
      if (hasValidTokens) {
        hasValidGmailAuth = await this.gmailIntegration.validateTokens(tokens);
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
      return createSuccessResult(undefined);
    } catch (error) {
      return handleServiceError(error);
    }
  }
}
