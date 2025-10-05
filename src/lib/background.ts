import { syncUserMessages } from "./gmail.js";
import { cleanupOfflineUsers, isUserOnline } from "./user.js";
import { prisma } from "./prisma.js";
import redis from "./cache.js";

class BackgroundService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  start() {
    if (this.isRunning) {
      console.log("Background service already running");
      return;
    }

    this.isRunning = true;
    console.log("Starting background service...");

    // Run every 30 seconds
    this.intervalId = setInterval(async () => {
      await this.runPeriodicTasks();
    }, 30000);

    // Also run once immediately
    this.runPeriodicTasks().catch((err) =>
      console.error("Initial background task error:", err)
    );
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("Background service stopped");
  }

  private async runPeriodicTasks() {
    try {
      // Get all online users
      const onlineUsers = await this.getOnlineUsers();

      // Sync messages for each online user
      for (const user of onlineUsers) {
        try {
          await syncUserMessages(user.firebaseUid);
        } catch (error) {
          console.error(
            `Failed to sync messages for user ${user.firebaseUid}:`,
            error
          );
        }
      }

      // Clean up offline users (run every 2 minutes)
      if (Date.now() % 240000 < 30000) {
        // Roughly every 2 minutes
        await cleanupOfflineUsers();
      }

      console.log(`Background sync completed for ${onlineUsers.length} users`);
    } catch (error) {
      console.error("Background service error:", error);
    }
  }

  private async getOnlineUsers() {
    try {
      // Get users who have been active recently
      const users = await prisma.user.findMany({
        where: {
          isOnline: true,
        },
        select: {
          firebaseUid: true,
          email: true,
        },
      });

      // Filter to actually online users (check Redis)
      const onlineUsers = [];
      for (const user of users) {
        if (await isUserOnline(user.firebaseUid)) {
          onlineUsers.push(user);
        }
      }

      return onlineUsers;
    } catch (error) {
      console.error("Error getting online users:", error);
      return [];
    }
  }

  // Manual trigger for testing
  async syncAllUsers() {
    const users = await this.getOnlineUsers();
    for (const user of users) {
      await syncUserMessages(user.firebaseUid);
    }
    console.log(`Manually synced ${users.length} users`);
  }
}

export const backgroundService = new BackgroundService();
