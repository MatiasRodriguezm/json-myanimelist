import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { MalClient } from "./malClient.js";
import { toAnimeSummary } from "./mapper.js";
import { Storage } from "./storage.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runEnrichment() {
  const mal = new MalClient(config.malClientId);
  const animeDir = config.paths.anime;
  const files = await fs.readdir(animeDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  console.log(`[EnrichExisting] Encontrados ${jsonFiles.length} archivos en data/anime/`);

  const pending = [];
  for (const file of jsonFiles) {
    const id = Number(path.basename(file, ".json"));
    if (!id || Number.isNaN(id)) continue;
    const data = await Storage.loadAnimeDetails(id);
    if (!data?.mal_details_updated_at) {
      pending.push({ id, title: data?.title || `Anime ${id}`, existing: data });
    }
  }

  console.log(`[EnrichExisting] ${pending.length} animes pendientes de enriquecer con detalles completos (related_anime)...`);

  let count = 0;
  let errors = 0;

  for (const { id, title, existing } of pending) {
    count++;
    try {
      const raw = await mal.getAnimeDetails(id);
      if (raw && raw.id) {
        const full = toAnimeSummary(raw);
        const enriched = {
          ...full,
          backdrop_url: existing?.backdrop_url || null,
          logo_url: existing?.logo_url || null,
          tmdb_id: existing?.tmdb_id || null,
          tmdb_updated_at: existing?.tmdb_updated_at || null,
          simkl_id: existing?.simkl_id || null,
          episodes_data: existing?.episodes_data || [],
          specials_data: existing?.specials_data || [],
          mal_details_updated_at: new Date().toISOString(),
        };
        await Storage.saveAnimeDetails(id, enriched);
      }
    } catch (err) {
      console.warn(`[EnrichExisting] [${count}/${pending.length}] Error en anime ${id} (${title}): ${err.message}`);
      errors++;
    }

    if (count % 25 === 0 || count === pending.length) {
      console.log(`[EnrichExisting] Progreso: ${count}/${pending.length} procesados (${errors} errores)...`);
    }

    await sleep(config.collector.requestDelayMs || 250);
  }

  console.log(`[EnrichExisting] Finalizado: ${count} animes procesados, ${errors} errores.`);
}

runEnrichment().catch(console.error);
