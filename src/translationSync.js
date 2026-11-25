import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { Storage } from "./storage.js";

const DELAY_MS = 60; // Pausa rápida y segura
const MAX_CONSECUTIVE_429 = 5;
const MAX_RUN_MS = 20 * 60 * 1000; // Máximo 20 minutos por corrida
const MAX_UPDATES_PER_RUN = 150;

let consecutive429s = 0;
let rateLimitedAbort = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Traduce un texto en inglés a español usando el endpoint público GTX
 */
async function translateGtx(text) {
  if (rateLimitedAbort) return null;
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();
  if (!clean) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (rateLimitedAbort) return null;
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      if (res.status === 429) {
        consecutive429s++;
        if (consecutive429s >= MAX_CONSECUTIVE_429) {
          console.warn(`[TransSync] ${consecutive429s} respuestas 429 seguidas. Deteniendo traducciones en esta corrida.`);
          rateLimitedAbort = true;
          return null;
        }
        console.warn(`[TransSync] 429 Too Many Requests, esperando ${attempt * 3}s...`);
        await sleep(attempt * 3000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        consecutive429s = 0;
        const translated = data[0].map((item) => (item && item[0] ? item[0] : "")).join("");
        return translated.trim();
      }
      return null;
    } catch (err) {
      if (attempt === 3) {
        console.warn(`[TransSync] Fallo al traducir: ${err.message}`);
      }
      await sleep(attempt * 1000);
    }
  }
  return null;
}

/**
 * Traduce los títulos de episodios por lotes usando un delimitador
 */
async function translateEpisodesBatch(episodes) {
  if (!Array.isArray(episodes) || episodes.length === 0) return episodes;

  const toTranslate = [];
  episodes.forEach((ep, idx) => {
    // Si ya tiene número genérico tipo "Episode 1" o "Episodio 1", no gastar peticiones
    if (ep.title && (!ep.title_es || ep.title_es.trim() === "")) {
      toTranslate.push({ idx, title: ep.title.trim() });
    }
  });

  if (toTranslate.length === 0) return episodes;

  // Si tiene más de 120 episodios sin traducir, traducimos los primeros 120 en esta pasada
  // para que el proceso avance rápido a todos los animes y no se tranque en shows de 2.000 capítulos
  const MAX_PER_RUN = 120;
  const targetBatch = toTranslate.slice(0, MAX_PER_RUN);

  const CHUNK_SIZE = 25;
  const DELIMITER = " |||| ";

  for (let i = 0; i < targetBatch.length; i += CHUNK_SIZE) {
    const chunk = targetBatch.slice(i, i + CHUNK_SIZE);
    const combinedText = chunk.map((c) => c.title).join(DELIMITER);

    const translatedCombined = await translateGtx(combinedText);
    if (translatedCombined) {
      const parts = translatedCombined.split(/\s*\|\|\|\|\s*/);
      chunk.forEach((item, chunkIdx) => {
        if (parts[chunkIdx]) {
          episodes[item.idx].title_es = parts[chunkIdx].trim();
        }
      });
    }
    await sleep(DELAY_MS);
  }

  return episodes;
}

async function run() {
  console.log("=== INICIANDO SINCRONIZACIÓN DE TRADUCCIONES (SINOPSIS Y EPISODIOS) ===");
  await Storage.initDirectories();
  const animeDir = config.paths.anime;
  const files = await fs.readdir(animeDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  console.log(`Se encontraron ${jsonFiles.length} archivos de anime en ${animeDir}`);

  let processedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for (const file of jsonFiles) {
    if (rateLimitedAbort) {
      console.warn("[TransSync] Abortando bucle por límite 429 de Google Translate.");
      break;
    }
    if (Date.now() - startTime >= MAX_RUN_MS) {
      console.warn("[TransSync] Límite de tiempo de corrida alcanzado (20m). Continuará en la próxima ejecución.");
      break;
    }
    if (updatedCount >= MAX_UPDATES_PER_RUN) {
      console.warn(`[TransSync] Límite de ${MAX_UPDATES_PER_RUN} actualizaciones alcanzado. Continuará en la próxima ejecución.`);
      break;
    }
    processedCount++;
    const id = Number(path.basename(file, ".json"));
    if (!id || Number.isNaN(id)) continue;

    try {
      const anime = await Storage.loadAnimeDetails(id);
      if (!anime) continue;

      let isDirty = false;

      // 1. Traducir Sinopsis si no tiene synopsis_es
      const needsSynopsisTranslation = anime.synopsis && (!anime.synopsis_es || anime.synopsis_es.trim() === "");
      if (needsSynopsisTranslation) {
        const trans = await translateGtx(anime.synopsis);
        if (trans) {
          anime.synopsis_es = trans;
          isDirty = true;
        }
        await sleep(DELAY_MS);
      }

      // 2. Traducir episodios normales de Simkl
      if (Array.isArray(anime.episodes_data) && anime.episodes_data.length > 0) {
        const hasUntranslatedEps = anime.episodes_data.some((e) => e.title && (!e.title_es || e.title_es.trim() === ""));
        if (hasUntranslatedEps) {
          await translateEpisodesBatch(anime.episodes_data);
          isDirty = true;
        }
      }

      // 3. Traducir especiales de Simkl
      if (Array.isArray(anime.specials_data) && anime.specials_data.length > 0) {
        const hasUntranslatedSpecials = anime.specials_data.some((e) => e.title && (!e.title_es || e.title_es.trim() === ""));
        if (hasUntranslatedSpecials) {
          await translateEpisodesBatch(anime.specials_data);
          isDirty = true;
        }
      }

      if (isDirty) {
        anime.translations_updated_at = new Date().toISOString();
        await Storage.saveAnimeDetails(id, anime);
        updatedCount++;
        console.log(`[${processedCount}/${jsonFiles.length}] [ACTUALIZADO] ${anime.title || file} (ID: ${anime.id})`);
      } else {
        skippedCount++;
        if (processedCount % 50 === 0) {
          console.log(`[${processedCount}/${jsonFiles.length}] Progreso: ${updatedCount} actualizados, ${skippedCount} ya listos...`);
        }
      }
    } catch (err) {
      errorCount++;
      console.error(`[${processedCount}/${jsonFiles.length}] [ERROR] en ${file}:`, err.message);
    }
  }

  console.log("\n=== RESUMEN FINAL DE TRADUCCIONES ===");
  console.log(`Total revisados: ${processedCount}`);
  console.log(`Actualizados con traducción: ${updatedCount}`);
  console.log(`Omitidos / Ya al día: ${skippedCount}`);
  console.log(`Errores: ${errorCount}`);
}

run().catch((e) => {
  console.error("Error fatal en translationSync:", e);
  process.exit(1);
});
