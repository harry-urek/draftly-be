import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { PrismaClient } from "@prisma/client";

import config from "./config/index.js";

// Repositories
import { UserRepository } from "./repositories/UserRepository.js";
import { EmailRepository } from "./repositories/EmailRepository.js";

// Integrations
import { GmailIntegration } from "./integrations/GmailIntegration.js";
import { VertexAIIntegration } from "./integrations/VertexAIIntegration.js";

// Services
import { AuthService } from "./services/AuthService.js";
import { EmailService } from "./services/EmailService.js";
import { UserService } from "./services/UserService.js";

// Controllers
import { AuthControllerImpl } from "./controllers/AuthController.js";
import { EmailController } from "./controllers/EmailController.js";
import { OnboardingController } from "./controllers/OnboardingController.js";

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize repositories
const userRepository = new UserRepository(prisma);
const emailRepository = new EmailRepository(prisma);

// Initialize integrations
const gmailIntegration = new GmailIntegration();
const vertexAIIntegration = new VertexAIIntegration();

// Initialize services
const authService = new AuthService(userRepository, gmailIntegration);
const emailService = new EmailService(
  emailRepository,
  userRepository,
  gmailIntegration,
  vertexAIIntegration
);
const userService = new UserService(userRepository, vertexAIIntegration);

// Initialize controllers
const authController = new AuthControllerImpl(authService);
const emailController = new EmailController(emailService);
const onboardingController = new OnboardingController();

export async function createApp() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      transport:
        config.nodeEnv !== "production"
          ? {
              target: "pino-pretty",
            }
          : undefined,
    },
  });

  // Register plugins
  await fastify.register(cors, {
    origin: [
      config.frontendUrl,
      "http://localhost:3000",
      "https://draftly.app",
    ],
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.jwtSecret,
  });

  if (config.nodeEnv !== "production") {
    await fastify.register(swagger, {
      swagger: {
        info: {
          title: "Draftly API",
          description: "AI-powered email assistant API",
          version: "1.0.0",
        },
        host: `localhost:${config.port}`,
        schemes: ["http"],
        consumes: ["application/json"],
        produces: ["application/json"],
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: {
        docExpansion: "full",
        deepLinking: false,
      },
    });
  }

  // Health check endpoint
  fastify.get("/health", async () => {
    try {
      // Test database connection
      await prisma.user.findFirst();

      // Test AI connection
      const aiConnected = await vertexAIIntegration.testConnection();

      return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
          database: "connected",
          vertexAI: aiConnected ? "connected" : "disconnected",
        },
      };
    } catch (error) {
      console.error("Health check failed:", error);
      throw new Error("Service unhealthy");
    }
  });

  // API status endpoint
  fastify.get("/api/status", async () => {
    return {
      service: "Draftly API",
      version: "1.0.0",
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  });

  // Register controller routes
  authController.registerRoutes(fastify);

  // Import auth middleware
  const { requireAuth } = await import("./middleware/auth.js");

  // Email routes
  fastify.get("/api/emails", { preHandler: requireAuth() }, emailController.getMessages.bind(emailController));
  fastify.post("/api/emails/sync", { preHandler: requireAuth() }, emailController.syncMessages.bind(emailController));
  fastify.get("/api/emails/refresh", { preHandler: requireAuth() }, emailController.refreshMessages.bind(emailController));
  fastify.get("/api/emails/:id", { preHandler: requireAuth() }, emailController.getMessage.bind(emailController));
  fastify.post("/api/emails/draft", { preHandler: requireAuth() }, emailController.generateDraft.bind(emailController));
  fastify.post("/api/emails/send", { preHandler: requireAuth() }, emailController.sendEmail.bind(emailController));

  // Onboarding routes
  fastify.post("/api/onboarding/start", { preHandler: requireAuth() }, onboardingController.startQuestionnaire.bind(onboardingController));
  fastify.get("/api/onboarding/status", { preHandler: requireAuth() }, onboardingController.getStatus.bind(onboardingController));
  fastify.post("/api/onboarding/generate-profile", { preHandler: requireAuth() }, onboardingController.generateProfile.bind(onboardingController));

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    if (error.statusCode) {
      reply.status(error.statusCode).send({
        error: error.message,
        statusCode: error.statusCode,
      });
    } else {
      reply.status(500).send({
        error: "Internal Server Error",
        statusCode: 500,
      });
    }
  });

  return fastify;
}

// Graceful shutdown
async function gracefulShutdown() {
  try {
    await prisma.$disconnect();
    console.log("✅ Database connection closed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

export { prisma, userService, emailService, authService };
