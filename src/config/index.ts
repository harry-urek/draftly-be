import "dotenv/config";

export interface AppConfig {
  // Server Configuration
  port: number;
  nodeEnv: string;
  frontendUrl: string;

  // Database Configuration
  databaseUrl: string;

  // Firebase Configuration
  firebaseProjectId: string;
  firebasePrivateKey: string;
  firebaseClientEmail: string;

  // Google OAuth Configuration
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;

  // Vertex AI Configuration
  vertexAiProjectId: string;
  vertexAiLocation: string;
  googleApplicationCredentials: string;

  // Redis Configuration
  redisUrl: string;

  // Encryption
  tokenEncryptionKey: string;
  jwtSecret: string;

  // Slack Configuration
  slackWebhookUrl?: string;
}

const requiredEnvVars = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "VERTEX_AI_PROJECT_ID",
  "REDIS_URL",
  "JWT_SECRET",
];

function validateConfig(): void {
  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

function createConfig(): AppConfig {
  validateConfig();

  return {
    // Server Configuration
    port: parseInt(process.env.PORT || "8000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",

    // Database Configuration
    databaseUrl: process.env.DATABASE_URL!,

    // Firebase Configuration
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID!,
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL!,

    // Google OAuth Configuration
    googleClientId: process.env.GOOGLE_CLIENT_ID!,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI!,

    // Vertex AI Configuration
    vertexAiProjectId: process.env.VERTEX_AI_PROJECT_ID!,
    vertexAiLocation: process.env.VERTEX_AI_LOCATION || "us-central1",
    googleApplicationCredentials:
      process.env.GOOGLE_APPLICATION_CREDENTIALS || "",

    // Redis Configuration
    redisUrl: process.env.REDIS_URL!,

    // Encryption
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
    jwtSecret: process.env.JWT_SECRET!,

    // Slack Configuration
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  };
}

export const config = createConfig();
export default config;
