import { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  fetchRecentEmailsForStyleLearning,
  cacheUserEmailsForOnboarding,
} from "../lib/onboarding-emails.js";
import { generateStyleProfile } from "../lib/vertexai.js";

export default async function onboardingRoutes(fastify: FastifyInstance) {
  // Start questionnaire and trigger background email fetching
  fastify.post("/start", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      // Update onboarding status
      await prisma.user.update({
        where: { firebaseUid: user.firebaseUid },
        data: { onboardingStatus: "QUESTIONNAIRE_IN_PROGRESS" },
      });

      // Trigger background email fetching (non-blocking)
      fetchAndCacheUserEmails(user.firebaseUid).catch((err) =>
        console.error("Background email fetch failed:", err)
      );

      return reply.send({
        status: "questionnaire_started",
        message: "Background email analysis started",
      });
    } catch (error) {
      console.error("Failed to start questionnaire:", error);
      return reply.status(500).send({
        error: "Failed to start onboarding",
      });
    }
  });

  // Check onboarding status
  fastify.get("/status", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      const userData = await prisma.user.findUnique({
        where: { firebaseUid: user.firebaseUid },
        select: {
          onboardingStatus: true,
          questionnaireData: true,
          aiStyleProfile: true,
        },
      });

      if (!userData) {
        return reply.status(404).send({ error: "User not found" });
      }

      return reply.send({
        status: userData.onboardingStatus,
        hasQuestionnaire: !!userData.questionnaireData,
        hasProfile: !!userData.aiStyleProfile,
      });
    } catch (error) {
      console.error("Failed to get onboarding status:", error);
      return reply.status(500).send({
        error: "Failed to get status",
      });
    }
  });

  // Submit questionnaire responses
  fastify.post("/submit", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;
      const responses = request.body as QuestionnaireResponses;

      // Validate response structure
      if (!responses.stylePreferences || !responses.scenarioResponses) {
        return reply.status(400).send({
          error: "Invalid questionnaire data",
        });
      }

      // Save questionnaire responses
      await prisma.user.update({
        where: { firebaseUid: user.firebaseUid },
        data: {
          questionnaireData: responses as any,
          onboardingStatus: "QUESTIONNAIRE_COMPLETED",
        },
      });

      // Trigger AI profile generation (non-blocking)
      generateUserStyleProfile(user.firebaseUid).catch((err) =>
        console.error("Profile generation failed:", err)
      );

      return reply.send({
        status: "submitted",
        message: "AI style profile generation started",
      });
    } catch (error) {
      console.error("Failed to submit questionnaire:", error);
      return reply.status(500).send({
        error: "Failed to submit questionnaire",
      });
    }
  });

  // Get AI-generated style profile
  fastify.get("/profile", { preHandler: requireAuth() }, async (request, reply) => {
    try {
      const user = request.firebaseUser!;

      const userData = await prisma.user.findUnique({
        where: { firebaseUid: user.firebaseUid },
        select: {
          aiStyleProfile: true,
          onboardingStatus: true,
        },
      });

      if (!userData) {
        return reply.status(404).send({ error: "User not found" });
      }

      if (!userData.aiStyleProfile) {
        return reply.status(404).send({
          error: "Profile not yet generated",
          status: userData.onboardingStatus,
        });
      }

      return reply.send({
        profile: userData.aiStyleProfile,
        status: userData.onboardingStatus,
      });
    } catch (error) {
      console.error("Failed to get style profile:", error);
      return reply.status(500).send({
        error: "Failed to get profile",
      });
    }
  });
}

// Background job: Fetch user's recent emails for style learning
async function fetchAndCacheUserEmails(firebaseUid: string) {
  console.log(`[Onboarding] Fetching emails for user: ${firebaseUid}`);

  try {
    // Fetch last 10 sent emails and 20 inbox messages
    const { sentEmails, inboxEmails } = await fetchRecentEmailsForStyleLearning(
      firebaseUid,
      { sentCount: 10, inboxCount: 20 }
    );

    // Cache in Redis for quick access during profile generation
    await cacheUserEmailsForOnboarding(firebaseUid, {
      sentEmails,
      inboxEmails,
    });

    console.log(
      `[Onboarding] Cached ${sentEmails.length} sent and ${inboxEmails.length} inbox emails`
    );
  } catch (error) {
    console.error("[Onboarding] Email fetch failed:", error);
    throw error;
  }
}

// Background job: Generate AI style profile using Vertex AI
async function generateUserStyleProfile(firebaseUid: string) {
  console.log(`[Onboarding] Generating style profile for user: ${firebaseUid}`);

  try {
    // Update status
    await prisma.user.update({
      where: { firebaseUid },
      data: { onboardingStatus: "PROFILE_GENERATING" },
    });

    // Get questionnaire responses
    const user = await prisma.user.findUnique({
      where: { firebaseUid },
      select: { questionnaireData: true },
    });

    if (!user?.questionnaireData) {
      throw new Error("No questionnaire data found");
    }

    // Generate profile using Vertex AI
    const styleProfile = await generateStyleProfile(
      user.questionnaireData as any
    );

    // Save generated profile
    await prisma.user.update({
      where: { firebaseUid },
      data: {
        aiStyleProfile: styleProfile as any,
        onboardingStatus: "ACTIVE",
      },
    });

    console.log(`[Onboarding] Profile generation complete for: ${firebaseUid}`);
  } catch (error) {
    console.error("[Onboarding] Profile generation failed:", error);

    // Reset status on failure
    await prisma.user.update({
      where: { firebaseUid },
      data: { onboardingStatus: "QUESTIONNAIRE_COMPLETED" },
    });

    throw error;
  }
}

// TypeScript types
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
  };
}
