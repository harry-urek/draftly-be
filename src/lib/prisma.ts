import { PrismaClient } from "@prisma/client";
import { slackNotifier } from "./slack.js";
import { MongoClient } from "mongodb";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Configure logging based on environment
const logLevel = process.env.PRISMA_LOG_LEVEL || "warn";
const logs: Array<"query" | "error" | "warn" | "info"> =
  logLevel === "debug"
    ? ["query", "error", "warn", "info"]
    : logLevel === "info"
    ? ["error", "warn", "info"]
    : ["error", "warn"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logs,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

async function ensureReplicaSetIfPossible() {
  const dbUrl = process.env.DATABASE_URL;
  const env = process.env.NODE_ENV || "development";
  const autoInit =
    (process.env.REPLICA_SET_AUTO_INIT || "true").toLowerCase() === "true";
  const rsName = process.env.REPLICA_SET_NAME || "rs0";

  if (!dbUrl || env === "production" || !autoInit) return;

  // Skip if connection string already declares a replica set or multiple hosts
  try {
    const url = new URL(dbUrl);
    if (url.searchParams.get("replicaSet")) return;
    const hosts = (url.host || url.hostname).split(",");
    if (hosts.length > 1) return;

    const host = url.hostname;
    const port = url.port || "27017";
    const dbName = (url.pathname || "/").replace(/\//g, "") || "admin";

    // Build a driver URL for MongoClient
    const auth = url.username
      ? `${encodeURIComponent(url.username)}:${encodeURIComponent(
          url.password
        )}@`
      : "";
    const directUrl = `mongodb://${auth}${host}:${port}/admin?directConnection=true`;

    const client = new MongoClient(directUrl, {
      serverSelectionTimeoutMS: 2000,
    });
    try {
      await client.connect();
      const adminDb = client.db("admin");

      // Check replica set status
      let rsStatus: any | undefined;
      try {
        rsStatus = await adminDb.command({ replSetGetStatus: 1 });
        if (rsStatus?.set) {
          // Already a replica set; append param for Prisma
          const patched = new URL(dbUrl);
          patched.searchParams.set("replicaSet", rsStatus.set);
          process.env.DATABASE_URL = patched.toString();
          return;
        }
      } catch (e: any) {
        const msg = e?.message?.toLowerCase?.() || "";
        const code = e?.code;
        if (msg.includes("not running with --replset")) {
          console.warn(
            "MongoDB is not started with --replSet. Cannot auto-initialize replica set."
          );
          return;
        }
        if (code === 94 || msg.includes("not yet initialized")) {
          // Try to initiate a single-node replica set
          try {
            await adminDb.command({
              replSetInitiate: {
                _id: rsName,
                members: [{ _id: 0, host: `${host}:${port}` }],
              },
            });
            // Update env to include replicaSet
            const patched = new URL(dbUrl);
            patched.searchParams.set("replicaSet", rsName);
            process.env.DATABASE_URL = patched.toString();
            console.log(
              `✅ Initialized MongoDB replica set '${rsName}' on ${host}:${port}`
            );
            return;
          } catch (initErr: any) {
            console.warn(
              "Failed to initiate replica set:",
              initErr?.message || initErr
            );
            return;
          }
        }
        // Other errors: log and continue
        console.warn("Replica set status check failed:", e?.message || e);
      }
    } finally {
      await client.close().catch(() => {});
    }
  } catch (err) {
    console.warn(
      "Replica set auto-init skipped due to URL parse/driver error:",
      err
    );
  }
}

// Test database connection
export async function testConnection() {
  try {
    await ensureReplicaSetIfPossible();
    await prisma.$connect();
    console.log("✅ Database connected successfully");
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", error);

    // Send database connection error notification to Slack
    if (process.env.NODE_ENV === "production") {
      await slackNotifier.databaseError(
        "Database Connection Failed",
        error as Error
      );
    }

    return false;
  }
}
