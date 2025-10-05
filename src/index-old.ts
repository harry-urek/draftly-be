import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import authRoutes from "./routes/auth.js";
import emailRoutes from "./routes/emails.js";
import onboardingRoutes from "./routes/onboarding.js";
import { testConnection } from "./lib/prisma";
import { backgroundService } from "./lib/background.js";
import { slackNotifier } from "./lib/slack.js";
import { testVertexAIConnection } from "./lib/vertexai.js";

const fastify = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
    },
  },
});

// Handle server errors with Slack notifications
fastify.setErrorHandler(async (error, request, reply) => {
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.serverError("Fastify Server Error", error);
  }
  fastify.log.error(error);
  reply.status(500).send({ error: "Internal Server Error" });
});

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.serverError("Uncaught Exception", error);
  }
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled rejections
process.on("unhandledRejection", async (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.serverError("Unhandled Promise Rejection", error);
  }
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Register plugins
async function registerPlugins() {
  // Swagger documentation
  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Draftly API",
        description: "Gmail AI Reply Agent Backend API",
        version: "1.0.0",
      },
      servers: [
        {
          url: `http://localhost:${process.env.PORT || "3001"}`,
          description: "Development server",
        },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "auth-token",
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "full",
      deepLinking: false,
    },
    uiHooks: {
      onRequest: function (request, reply, next) {
        next();
      },
      preHandler: function (request, reply, next) {
        next();
      },
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });

  // CORS
  await fastify.register(cors, {
    origin: [process.env.FRONTEND_URL || "http://localhost:3000"],
    credentials: true,
  });

  // Cookie support
  await fastify.register(cookie);

  // JWT
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || "fallback-secret",
    cookie: {
      cookieName: "auth-token",
      signed: false,
    },
  });

  // Authentication decorator
  fastify.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

// Register routes
async function registerRoutes() {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(emailRoutes);
  await fastify.register(onboardingRoutes, { prefix: "/onboarding" });
}

// Health check
fastify.get(
  "/health",
  {
    schema: {
      description: "Health check endpoint with system status",
      tags: ["System"],
      response: {
        200: {
          description: "System health status",
          type: "object",
          properties: {
            status: { type: "string" },
            timestamp: { type: "string" },
            database: { type: "string" },
            googleOAuth: { type: "string" },
            aiService: { type: "string" },
            environment: { type: "string" },
          },
        },
      },
    },
  },
  async () => {
    const dbStatus = await testConnection();
    const aiStatus = await testVertexAIConnection();
    console.log(
      "TOKEN_ENCRYPTION_KEY loaded:",
      !!process.env.TOKEN_ENCRYPTION_KEY
    );
    const googleOAuthConfigured =
      process.env.GOOGLE_CLIENT_ID &&
      !process.env.GOOGLE_CLIENT_ID.includes("your_google_client_id");

    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      database: dbStatus ? "connected" : "disconnected",
      googleOAuth: googleOAuthConfigured ? "configured" : "not configured",
      aiService: aiStatus.connected
        ? `connected (${aiStatus.provider})`
        : "disconnected",
      environment: process.env.NODE_ENV || "development",
    };
  }
);

// Start server
async function start() {
  try {
    // Test database connection first
    const dbConnected = await testConnection();
    if (!dbConnected) {
      console.log(
        "⚠️  Warning: Database connection failed. Some features may not work."
      );
      console.log("💡 Make sure MongoDB is running on localhost:27017");
    }

    // Test Vertex AI connection
    const vertexAIStatus = await testVertexAIConnection();
    if (!vertexAIStatus.connected) {
      console.log("⚠️  Warning: AI service connection failed.");
      console.log(`   Error: ${vertexAIStatus.error}`);
      console.log(
        "💡 AI profile generation will not work until this is fixed."
      );
      if (vertexAIStatus.provider === "Vertex AI") {
        console.log(
          "   See server/GCP-SERVICE-ACCOUNT-SETUP.md for Vertex AI setup."
        );
        console.log(
          "   Or set GEMINI_API_KEY in .env for simpler setup (no billing required)."
        );
      } else {
        console.log(
          "   Get your Gemini API key from: https://aistudio.google.com/app/apikey"
        );
      }
    } else {
      console.log(
        `✅ AI service connected: ${vertexAIStatus.provider || "Unknown"}`
      );
    }

    await registerPlugins();
    await registerRoutes();

    const port = parseInt(process.env.PORT || "3001");
    const host = process.env.HOST || "localhost";

    await fastify.listen({ port, host });
    console.log(`🚀 Server running on http://${host}:${port}`);
    console.log(`📚 API Documentation: http://${host}:${port}/docs`);
    console.log(`❤️  Health Check: http://${host}:${port}/health`);

    // Send server startup notification to Slack
    if (process.env.NODE_ENV === "production") {
      await slackNotifier.serverStartup(port, host);
    }

    // Start background service for message syncing
    backgroundService.start();
    console.log(`🔄 Background service started`);

    // Log environment status
    if (process.env.GOOGLE_CLIENT_ID?.includes("your_google_client_id")) {
      console.log(
        "⚠️  Warning: Google OAuth not configured. Update GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env"
      );
    }
  } catch (error) {
    fastify.log.error(error);

    // Send server startup error notification to Slack
    if (process.env.NODE_ENV === "production") {
      await slackNotifier.serverError("Server Startup Failed", error as Error);
    }

    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");

  // Send server shutdown notification to Slack
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.serverShutdown("SIGTERM");
  }

  backgroundService.stop();
  await fastify.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");

  // Send server shutdown notification to Slack
  if (process.env.NODE_ENV === "production") {
    await slackNotifier.serverShutdown("SIGINT");
  }

  backgroundService.stop();
  await fastify.close();
  process.exit(0);
});

start();
