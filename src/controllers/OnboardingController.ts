/* eslint-disable import/no-unresolved */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest, FastifyReply } from "fastify";

import {
  fetchRecentEmailsForStyleLearning,
  cacheUserEmailsForOnboarding,
} from "../lib/onboarding-emails";
import { prisma } from "../lib/prisma";
import { generateStyleProfile } from "../lib/vertexai";
import { OnboardingStatus, AIStyleProfile } from "../types";

export class OnboardingController {
  async startQuestionnaire(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { firebaseUid } = request.firebaseUser;

      // Update onboarding status
      await prisma.user.update({
        where: { firebaseUid },
        data: {
          onboardingStatus: "QUESTIONNAIRE_IN_PROGRESS" as OnboardingStatus,
        },
      });

      // Trigger background email fetching (non-blocking)
      (async () => {
        try {
          const { sentEmails, inboxEmails } =
            await fetchRecentEmailsForStyleLearning(firebaseUid, {
              sentCount: 10,
              inboxCount: 20,
            });
          await cacheUserEmailsForOnboarding(firebaseUid, {
            sentEmails,
            inboxEmails,
          });
          request.log?.info(
            `[Onboarding] Cached emails for ${firebaseUid}: sent=${sentEmails.length}, inbox=${inboxEmails.length}`
          );
        } catch (err) {
          request.log?.error(
            { err },
            "[Onboarding] Background email fetch failed"
          );
        }
      })();

      reply.send({
        status: "questionnaire_started",
        message: "Background email analysis started",
      });
    } catch (error: unknown) {
      console.error("Error starting questionnaire:", error);
      reply.code(500).send({
        error: "Failed to start questionnaire",
      });
    }
  }

  async getStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { firebaseUid } = request.firebaseUser;

      const user = await prisma.user.findUnique({
        where: { firebaseUid },
        select: {
          onboardingStatus: true,
          questionnaireData: true,
          aiStyleProfile: true,
        },
      });

      if (!user) {
        reply.code(404).send({ error: "User not found" });
        return;
      }

      reply.send({
        status: user.onboardingStatus as OnboardingStatus,
        hasQuestionnaire: Boolean(user.questionnaireData),
        hasProfile: Boolean(user.aiStyleProfile),
      });
    } catch (error: unknown) {
      console.error("Error getting onboarding status:", error);
      reply.code(500).send({
        error: "Failed to get onboarding status",
      });
    }
  }

  async generateProfile(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      if (!request.firebaseUser) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      const { firebaseUid } = request.firebaseUser;
      const questionnaireData = request.body as QuestionnaireResponses;

      if (!questionnaireData || Object.keys(questionnaireData).length === 0) {
        reply.code(400).send({ error: "Questionnaire data is required" });
        return;
      }

      // Save questionnaire and advance status
      await prisma.user.update({
        where: { firebaseUid },
        data: {
          questionnaireData: questionnaireData as unknown as object,
          onboardingStatus: "QUESTIONNAIRE_COMPLETED" as OnboardingStatus,
        },
      });

      // Trigger AI profile generation in background
      (async () => {
        try {
          // Set generating status
          await prisma.user.update({
            where: { firebaseUid },
            data: {
              onboardingStatus: "PROFILE_GENERATING" as OnboardingStatus,
            },
          });

          // Generate profile using Vertex AI
          const styleProfile = (await generateStyleProfile(
            questionnaireData as unknown as Record<string, any>
          )) as AIStyleProfile;

          // Store profile and set ACTIVE
          await prisma.user.update({
            where: { firebaseUid },
            data: {
              aiStyleProfile: styleProfile as unknown as object,
              onboardingStatus: "COMPLETED_INIT_PROFILE" as OnboardingStatus,
            },
          });
        } catch (err) {
          console.error("[Onboarding] Profile generation failed:", err);
          // Reset to completed to allow retry
          await prisma.user.update({
            where: { firebaseUid },
            data: {
              onboardingStatus: "PROFILE_ERROR" as OnboardingStatus,
            },
          });
        }
      })();

      reply.send({
        status: "submitted",
        message: "AI style profile generation started",
      });
    } catch (error: unknown) {
      console.error("Error generating profile:", error);
      reply.code(500).send({
        error: "Failed to generate style profile",
      });
    }
  }
}

// TypeScript types aligned with routes/onboarding schema
interface QuestionnaireResponses {
  userId: string;
  submissionTimestamp: string;
  stylePreferences: {
    greeting: string;
    formalityScale: number;
    requestStyle: string;
    emojiFrequency: string;
  };
  scenarioResponses: Array<{
    scenarioId: string;
    responseText: string;
  }>;
  stylisticNuances: {
    commonSignOffs: string[];
    commonPhrases: string[];
    petPeeve: string;
    writingTone?: string[];
    punctuationStyle?: string;
  };
}
