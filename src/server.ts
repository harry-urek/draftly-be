import { createApp, backgroundService } from "./app";
import config from "./config/index";

async function startServer() {
  try {
    const app = await createApp();

    // Start the server
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(`🚀 Server running on port ${config.port}`);

    // Start the background service
    backgroundService.start();
    app.log.info("🔄 Background service started");
  } catch (error) {
    console.error("❌ Error starting server:", error);
    process.exit(1);
  }
}

startServer();
