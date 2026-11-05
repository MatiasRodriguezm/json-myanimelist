import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env") });

export const config = {
  port: Number(process.env.PORT || 4000),
  malClientId: process.env.MAL_CLIENT_ID || "fdfaa87254aa7ccb69b33147a5205743",
  cronSchedule: process.env.CRON_SCHEDULE || "0 */6 * * *",
  syncOnStartup: process.env.SYNC_ON_STARTUP === "true" || process.env.SYNC_ON_STARTUP === undefined,
  syncApiKey: process.env.SYNC_API_KEY || "",
  paths: {
    root: rootDir,
    data: path.join(rootDir, "data"),
    anime: path.join(rootDir, "data", "anime"),
    homeJson: path.join(rootDir, "data", "home.json"),
    discoverJson: path.join(rootDir, "data", "discover.json"),
    metadataIndexJson: path.join(rootDir, "data", "metadata_index.json"),
    statusJson: path.join(rootDir, "data", "status.json"),
    livechartScheduleJson: path.join(rootDir, "data", "livechart_past_schedule.json"),
    livechartMalMapJson: path.join(rootDir, "data", "livechart_mal_map.json"),
  },
  // Límites para recolección automática
  collector: {
    homeRankingLimit: 25,
    seasonLimit: 500,
    discoverSectionLimit: 50,
    requestDelayMs: 250, // Respetar la API de MyAnimeList para evitar 429
  },
};
