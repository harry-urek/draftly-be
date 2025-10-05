import { IncomingWebhook } from "@slack/webhook";

interface SlackNotificationData {
  level: "error" | "warning" | "info" | "success";
  title: string;
  message: string;
  error?: Error;
  userId?: string;
  request?: {
    method: string;
    url: string;
    userAgent?: string;
    ip?: string;
  };
  metadata?: Record<string, any>;
}

class SlackNotifier {
  private webhook: IncomingWebhook | null = null;
  private isEnabled = false;

  constructor() {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (webhookUrl) {
      this.webhook = new IncomingWebhook(webhookUrl);
      this.isEnabled = true;
      console.log("✅ Slack notifications enabled");
    } else {
      console.log(
        "⚠️ Slack webhook URL not configured - notifications disabled"
      );
    }
  }

  private getEmojiForLevel(level: string): string {
    switch (level) {
      case "error":
        return "🚨";
      case "warning":
        return "⚠️";
      case "info":
        return "ℹ️";
      case "success":
        return "✅";
      default:
        return "📢";
    }
  }

  private getColorForLevel(level: string): string {
    switch (level) {
      case "error":
        return "danger";
      case "warning":
        return "warning";
      case "info":
        return "#36a64f";
      case "success":
        return "good";
      default:
        return "#764FA5";
    }
  }

  async sendNotification(data: SlackNotificationData): Promise<void> {
    if (!this.isEnabled || !this.webhook) {
      return;
    }

    try {
      const emoji = this.getEmojiForLevel(data.level);
      const color = this.getColorForLevel(data.level);

      const fields: any[] = [
        {
          title: "Environment",
          value: process.env.NODE_ENV || "development",
          short: true,
        },
        {
          title: "Service",
          value: "Draftly Server",
          short: true,
        },
      ];

      if (data.userId) {
        fields.push({
          title: "User ID",
          value: data.userId,
          short: true,
        });
      }

      if (data.request) {
        fields.push({
          title: "Request",
          value: `${data.request.method} ${data.request.url}`,
          short: false,
        });

        if (data.request.ip) {
          fields.push({
            title: "IP Address",
            value: data.request.ip,
            short: true,
          });
        }
      }

      if (data.error) {
        fields.push({
          title: "Error Details",
          value: `\`\`\`${data.error.stack || data.error.message}\`\`\``,
          short: false,
        });
      }

      if (data.metadata) {
        for (const [key, value] of Object.entries(data.metadata)) {
          fields.push({
            title: key,
            value: typeof value === "string" ? value : JSON.stringify(value),
            short: true,
          });
        }
      }

      await this.webhook.send({
        text: `${emoji} ${data.title}`,
        attachments: [
          {
            color,
            title: data.title,
            text: data.message,
            fields,
            footer: "Draftly Monitoring",
            ts: Math.floor(Date.now() / 1000).toString(),
          },
        ],
      });
    } catch (error) {
      console.error("Failed to send Slack notification:", error);
    }
  }

  // Convenience methods for different notification types
  async error(
    title: string,
    message: string,
    error?: Error,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.sendNotification({
      level: "error",
      title,
      message,
      error,
      metadata,
    });
  }

  async warning(
    title: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.sendNotification({
      level: "warning",
      title,
      message,
      metadata,
    });
  }

  async info(
    title: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.sendNotification({
      level: "info",
      title,
      message,
      metadata,
    });
  }

  async success(
    title: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.sendNotification({
      level: "success",
      title,
      message,
      metadata,
    });
  }

  // Server lifecycle notifications
  async serverStartup(port: number, host: string): Promise<void> {
    await this.success(
      "Server Started",
      `Draftly server is running on ${host}:${port}`,
      { port, host, environment: process.env.NODE_ENV }
    );
  }

  async serverShutdown(signal: string): Promise<void> {
    await this.warning(
      "Server Shutdown",
      `Draftly server shutting down (${signal})`,
      { signal, environment: process.env.NODE_ENV }
    );
  }

  async serverError(title: string, error: Error): Promise<void> {
    await this.error(title, "Critical server error occurred", error, {
      service: "draftly-server",
    });
  }

  // Authentication notifications
  async authError(error: Error, request?: any): Promise<void> {
    await this.sendNotification({
      level: "error",
      title: "Authentication Error",
      message: "User authentication failed",
      error,
      request: request
        ? {
            method: request.method,
            url: request.url,
            userAgent: request.headers["user-agent"],
            ip: request.ip,
          }
        : undefined,
    });
  }

  // Gmail API notifications
  async gmailQuotaExceeded(userId: string, error: Error): Promise<void> {
    await this.warning(
      "Gmail Quota Exceeded",
      "Gmail API quota limit reached for user",
      { userId, service: "gmail-api", error: error.message }
    );
  }

  async gmailSyncError(userId: string, error: Error): Promise<void> {
    await this.error(
      "Gmail Sync Error",
      "Failed to sync Gmail messages for user",
      error,
      { userId, service: "gmail-sync" }
    );
  }

  // Database notifications
  async databaseError(title: string, error: Error): Promise<void> {
    await this.error(title, "Database operation failed", error, {
      service: "database",
    });
  }

  // Cache notifications
  async cacheError(title: string, error: Error): Promise<void> {
    await this.error(title, "Redis cache operation failed", error, {
      service: "redis",
    });
  }
}

export const slackNotifier = new SlackNotifier();
