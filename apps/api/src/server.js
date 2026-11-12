import { createDatabase } from "@coaching/db";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const db = await createDatabase({ connectionString: env.databaseUrl, pgliteDir: env.pgliteDir });
const app = createApp(db);
const server = app.listen(env.port, () => {
  logger.info("api listening", {
    port: env.port,
    env: env.nodeEnv,
    database: db.driver,
    ...(db.driver === "pglite" ? { pgliteDir: env.pgliteDir } : {})
  });
});

async function shutdown(signal) {
  logger.info("shutting down", { signal });
  server.close(async () => {
    try {
      await db.close();
    } finally {
      process.exit(0);
    }
  });
  // Force-exit if connections do not drain.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
