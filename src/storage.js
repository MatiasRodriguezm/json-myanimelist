import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// Cache en memoria para respuestas de latencia 0 ms
const memoryCache = {
  home: null,
  discover: null,
  anime: new Map(),
  status: null,
};

export class Storage {
  static async initDirectories() {
    await fs.mkdir(config.paths.data, { recursive: true });
    await fs.mkdir(config.paths.anime, { recursive: true });
  }

  /**
   * Escritura atómica para evitar que una interrupción deje el archivo JSON corrupto.
   */
  static async writeJsonAtomic(filePath, data) {
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const jsonString = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, jsonString, "utf-8");
    await fs.rename(tempPath, filePath);
  }

  static async readJsonSafe(filePath) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  static async saveHomeFeed(homeFeed) {
    memoryCache.home = homeFeed;
    await this.writeJsonAtomic(config.paths.homeJson, homeFeed);
  }

  static async loadHomeFeed() {
    if (memoryCache.home) return memoryCache.home;
    const fromDisk = await this.readJsonSafe(config.paths.homeJson);
    if (fromDisk) memoryCache.home = fromDisk;
    return fromDisk;
  }

  static async saveDiscover(discoverData) {
    memoryCache.discover = discoverData;
    await this.writeJsonAtomic(config.paths.discoverJson, discoverData);
  }

  static async loadDiscover() {
    if (memoryCache.discover) return memoryCache.discover;
    const fromDisk = await this.readJsonSafe(config.paths.discoverJson);
    if (fromDisk) memoryCache.discover = fromDisk;
    return fromDisk;
  }

  static async saveAnimeDetails(animeId, animeData) {
    memoryCache.anime.set(Number(animeId), animeData);
    const filePath = path.join(config.paths.anime, `${animeId}.json`);
    await this.writeJsonAtomic(filePath, animeData);
  }

  static async loadAnimeDetails(animeId) {
    const id = Number(animeId);
    if (memoryCache.anime.has(id)) {
      return memoryCache.anime.get(id);
    }
    const filePath = path.join(config.paths.anime, `${id}.json`);
    const fromDisk = await this.readJsonSafe(filePath);
    if (fromDisk) {
      memoryCache.anime.set(id, fromDisk);
      return fromDisk;
    }
    return null;
  }

  static hasAnimeDetails(animeId) {
    const id = Number(animeId);
    if (memoryCache.anime.has(id)) return true;
    const filePath = path.join(config.paths.anime, `${id}.json`);
    return fsSync.existsSync(filePath);
  }

  static async saveStatus(statusData) {
    memoryCache.status = statusData;
    await this.writeJsonAtomic(config.paths.statusJson, statusData);
  }

  static async loadStatus() {
    if (memoryCache.status) return memoryCache.status;
    const fromDisk = await this.readJsonSafe(config.paths.statusJson);
    if (fromDisk) memoryCache.status = fromDisk;
    return fromDisk;
  }

  static async saveLiveChartSchedule(data) {
    await this.writeJsonAtomic(config.paths.livechartScheduleJson, data);
  }

  static async loadLiveChartSchedule() {
    return (await this.readJsonSafe(config.paths.livechartScheduleJson)) || null;
  }

  static async saveLiveChartMalMap(data) {
    await this.writeJsonAtomic(config.paths.livechartMalMapJson, data);
  }

  static async loadLiveChartMalMap() {
    return (await this.readJsonSafe(config.paths.livechartMalMapJson)) || {};
  }

  static async getStats() {
    let animeCount = 0;
    try {
      const files = await fs.readdir(config.paths.anime);
      animeCount = files.filter((f) => f.endsWith(".json")).length;
    } catch {
      animeCount = 0;
    }

    const status = await this.loadStatus();
    return {
      cachedAnimeCount: animeCount,
      hasHomeFeed: fsSync.existsSync(config.paths.homeJson),
      hasDiscover: fsSync.existsSync(config.paths.discoverJson),
      lastSync: status?.lastSync || null,
      lastSyncDurationSeconds: status?.durationSeconds || null,
      lastSyncStatus: status?.status || "never",
    };
  }
}
