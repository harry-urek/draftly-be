import { UserRepository } from "../repositories/UserRepository.js";
import { VertexAIIntegration } from "../integrations/VertexAIIntegration.js";
import { User, AIStyleProfile } from "../types/index.js";
import { ServiceResult, createSuccessResult, handleServiceError } from "../utils/errors.js";

export class UserService {
  constructor(
    private userRepository: UserRepository,
    private vertexAIIntegration: VertexAIIntegration
  ) {}

  async getUserProfile(firebaseUid: string): Promise<ServiceResult<User>> {
    try {
      const user = await this.userRepository.findByFirebaseUid(firebaseUid);
      if (!user) {
        return { success: false, error: 'User not found' };
      }
      return createSuccessResult(user);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateProfile(firebaseUid: string, updates: Partial<User>): Promise<ServiceResult<User>> {
    try {
      const updatedUser = await this.userRepository.update(firebaseUid, updates);
      return createSuccessResult(updatedUser);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async generateStyleProfile(
    firebaseUid: string,
    questionnaireData: Record<string, any>
  ): Promise<ServiceResult<AIStyleProfile>> {
    try {
      // Update onboarding status to generating
      await this.userRepository.updateOnboardingStatus(firebaseUid, 'PROFILE_GENERATING');

      // Generate AI style profile
      const styleProfile = await this.vertexAIIntegration.generateStyleProfile(questionnaireData);

      // Store the profile and questionnaire data
      await this.userRepository.storeStyleProfile(firebaseUid, styleProfile);
      
      // Update onboarding status to active
      await this.userRepository.updateOnboardingStatus(firebaseUid, 'ACTIVE');

      return createSuccessResult(styleProfile);
    } catch (error) {
      // Reset onboarding status on error
      await this.userRepository.updateOnboardingStatus(firebaseUid, 'QUESTIONNAIRE_COMPLETED');
      return handleServiceError(error);
    }
  }

  async getStyleProfile(firebaseUid: string): Promise<ServiceResult<AIStyleProfile | null>> {
    try {
      const profile = await this.userRepository.getStyleProfile(firebaseUid);
      return createSuccessResult(profile);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateOnboardingProgress(
    firebaseUid: string,
    status: string,
    questionnaireData?: Record<string, any>
  ): Promise<ServiceResult<void>> {
    try {
      await this.userRepository.updateOnboardingStatus(firebaseUid, status);
      
      // Store questionnaire data if provided
      if (questionnaireData) {
        // Implementation would need to be added to repository
        // For now, just update the status
      }

      return createSuccessResult(undefined);
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async testAIConnection(): Promise<ServiceResult<boolean>> {
    try {
      const isConnected = await this.vertexAIIntegration.testConnection();
      return createSuccessResult(isConnected);
    } catch (error) {
      return handleServiceError(error);
    }
  }
}
