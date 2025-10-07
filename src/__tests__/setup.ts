import { config } from "dotenv";

// Load test environment variables
config({ path: ".env.test" });

// Global test setup
beforeAll(async () => {
  // Setup test database connection, mock services, etc.
  process.env.NODE_ENV = "test";
});

afterAll(async () => {
  // Cleanup test resources
});

// Extend global types
declare global {
  namespace NodeJS {
    interface Global {
      testUtils: any;
    }
  }
}
