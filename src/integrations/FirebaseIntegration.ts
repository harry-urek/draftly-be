import admin from "firebase-admin";
import { Auth as AdminAuth } from "firebase-admin/auth";
import { initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";
import config from "../config/index.js";

/**
 * Firebase integration handling both admin and client SDK initialization
 */
export class FirebaseIntegration {
  private static instance: FirebaseIntegration;
  private adminAuth: AdminAuth;
  private clientAuth: Auth | null = null;
  private isAdminInitialized = false;
  private isClientInitialized = false;

  private constructor() {
    this.initializeAdmin();
    // Client SDK is initialized on-demand
    this.adminAuth = admin.auth();
  }

  public static getInstance(): FirebaseIntegration {
    if (!FirebaseIntegration.instance) {
      FirebaseIntegration.instance = new FirebaseIntegration();
    }
    return FirebaseIntegration.instance;
  }

  /**
   * Initialize Firebase Admin SDK
   */
  private initializeAdmin(): void {
    if (this.isAdminInitialized || admin.apps.length > 0) {
      this.isAdminInitialized = true;
      return;
    }

    try {
      const serviceAccount = {
        type: "service_account",
        project_id: config.firebaseProjectId,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "",
        private_key: config.firebasePrivateKey,
        client_email: config.firebaseClientEmail,
        client_id: process.env.FIREBASE_CLIENT_ID || "",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${config.firebaseClientEmail.replace(
          "@",
          "%40"
        )}`,
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
        projectId: config.firebaseProjectId,
      });
      
      this.isAdminInitialized = true;
      console.log("✅ Firebase Admin SDK initialized successfully");
    } catch (error) {
      console.error("❌ Firebase Admin SDK initialization failed:", error);
      throw new Error(`Firebase Admin SDK initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize Firebase Client SDK (on demand, only when needed)
   */
  private initializeClient(): void {
    if (this.isClientInitialized) {
      return;
    }

    try {
      // Check for required environment variables
      if (!process.env.FIREBASE_API_KEY) {
        throw new Error("Missing FIREBASE_API_KEY environment variable");
      }

      const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: `${config.firebaseProjectId}.firebaseapp.com`,
        projectId: config.firebaseProjectId,
        storageBucket: `${config.firebaseProjectId}.appspot.com`,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
        appId: process.env.FIREBASE_APP_ID || "",
      };

      // Initialize Firebase Client SDK
      const app = initializeApp(firebaseConfig);
      this.clientAuth = getAuth(app);
      
      this.isClientInitialized = true;
      console.log("✅ Firebase Client SDK initialized successfully");
    } catch (error) {
      console.error("❌ Firebase Client SDK initialization failed:", error);
      throw new Error(`Firebase Client SDK initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get Firebase Admin Auth instance
   */
  public getAdminAuth(): AdminAuth {
    if (!this.isAdminInitialized) {
      this.initializeAdmin();
    }
    return this.adminAuth;
  }

  /**
   * Get Firebase Client Auth instance (initialized on demand)
   */
  public getClientAuth(): Auth {
    if (!this.isClientInitialized) {
      this.initializeClient();
    }
    return this.clientAuth!;
  }

  /**
   * Verify Firebase ID token using Admin SDK
   */
  public async verifyIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    try {
      const decodedToken = await this.getAdminAuth().verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      console.error("Firebase token verification failed:", error);
      throw new Error("Invalid Firebase token");
    }
  }
}

// Export a singleton instance
export const firebaseIntegration = FirebaseIntegration.getInstance();
