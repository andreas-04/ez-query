/**
 * Loads the project-root .env file into process.env.
 * Must be the first import in any entry-point (server.ts, tui.ts).
 * dotenv.config() is synchronous, so by the time the next require() runs
 * all env vars are already available to every module that follows.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../.env") });
