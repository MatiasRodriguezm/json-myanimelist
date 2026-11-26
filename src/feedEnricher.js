import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { Storage } from "./storage.js";

async function enrichFeedFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const feed = JSON.parse(raw);
    let changed = false;

    async function updateItem(item) {
      if (!item || !item.id) return item;
      const detail = await Storage.loadAnimeDetails(item.id);
      if (detail) {
        if (detail.synopsis_es && item.synopsis_es !== detail.synopsis_es) {
          item.synopsis_es = detail.synopsis_es;
          changed = true;
        }
        if (detail.characters && Array.isArray(detail.characters) && detail.characters.length > 0) {
          if (!item.characters || item.characters.length === 0) {
            item.characters = detail.characters;
            changed = true;
          }
        }
      }
      return item;
    }

    if (feed.featured) feed.featured = await updateItem(feed.featured);

    const arrayKeys = ["topAnime", "seasonalAnime", "upcomingAnime", "popularYearAnime", "popularAirings", "bannerList", "items"];
    for (const key of arrayKeys) {
      if (Array.isArray(feed[key])) {
        for (let i = 0; i < feed[key].length; i++) {
          feed[key][i] = await updateItem(feed[key][i]);
        }
      }
    }

    if (Array.isArray(feed.curatedList)) {
      for (let i = 0; i < feed.curatedList.length; i++) {
        feed.curatedList[i] = await updateItem(feed.curatedList[i]);
      }
    }

    if (Array.isArray(feed.sections)) {
      for (const sec of feed.sections) {
        if (Array.isArray(sec.items)) {
          for (let i = 0; i < sec.items.length; i++) {
            sec.items[i] = await updateItem(sec.items[i]);
          }
        }
      }
    }

    if (changed) {
      await Storage.writeJsonAtomic(filePath, feed);
      console.log(`[FeedSync] Enriquecido con éxito: ${path.basename(filePath)}`);
    } else {
      console.log(`[FeedSync] Sin cambios en: ${path.basename(filePath)}`);
    }
  } catch (err) {
    console.error(`[FeedSync] Error en ${filePath}:`, err.message);
  }
}

async function run() {
  console.log("=== ENRIQUECIENDO HOME, DISCOVER, GÉNEROS Y TEMAS CON SINOPSIS_ES Y PERSONAJES ===");
  await enrichFeedFile(config.paths.homeJson);
  await enrichFeedFile(config.paths.discoverJson);
  if (config.paths.popularYearJson) await enrichFeedFile(config.paths.popularYearJson);

  // También en genres, themes y producers
  for (const folder of [config.paths.genres, config.paths.themes, config.paths.producersDir]) {
    try {
      const files = await fs.readdir(folder);
      for (const file of files) {
        if (file.endsWith(".json")) {
          await enrichFeedFile(path.join(folder, file));
        }
      }
    } catch (e) {
      // Ignorar si no existe
    }
  }

  console.log("=== ENRIQUECIMIENTO FINALIZADO ===");
}

run();
