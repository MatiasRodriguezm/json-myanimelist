import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { Storage } from "./storage.js";

const JIKAN_BASE_URL = process.env.JIKAN_API_URL || "https://animejikanapi-7p32.onrender.com";
const DELAY_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPersonName(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[1]} ${parts[0]}`;
    }
  }
  return trimmed;
}

function mapCharacter(raw) {
  const c = raw.character || {};
  const charId = c.malId || null;
  const name = formatPersonName(c.name || "");
  const role = raw.role || "Supporting";
  const imgUrl = c.images?.jpg?.imageUrl || c.images?.webp?.imageUrl || null;

  if (!charId || !name) return null;

  return {
    id: charId,
    name: name,
    role: role,
    imageUrl: imgUrl,
  };
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AnimeHub-Character-Sync/1.0" },
      });
      if (res.ok) {
        return await res.json();
      }
      console.warn(`[CharSync] HTTP ${res.status} en ${url} (Intento ${attempt}/${maxRetries})`);
    } catch (err) {
      console.warn(`[CharSync] Error de red en ${url}: ${err.message} (Intento ${attempt}/${maxRetries})`);
    }
    await sleep(attempt * 1200);
  }
  return null;
}

export async function syncAnimeCharacters() {
  console.log(`\n==================================================`);
  console.log(`[CharSync] Iniciando enriquecimiento de personajes desde ${JIKAN_BASE_URL}`);
  console.log(`==================================================`);

  await Storage.initDirectories();
  const animeDir = config.paths.anime;
  const files = await fs.readdir(animeDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  console.log(`[CharSync] ${jsonFiles.length} animes encontrados en data/anime/`);

  const pending = [];
  for (const file of jsonFiles) {
    const id = Number(path.basename(file, ".json"));
    if (!id || Number.isNaN(id)) continue;
    const data = await Storage.loadAnimeDetails(id);
    if (!data?.characters || !Array.isArray(data.characters) || data.characters.length === 0) {
      pending.push({ id, title: data?.title || `Anime ${id}`, existing: data });
    }
  }

  console.log(`[CharSync] ${pending.length} animes pendientes de enriquecer con personajes...`);

  let count = 0;
  let successCount = 0;
  let errors = 0;

  for (const { id, title, existing } of pending) {
    count++;
    process.stdout.write(`[CharSync] [${count}/${pending.length}] ID ${id} (${title.slice(0, 30)})... `);

    try {
      const charRes = await fetchWithRetry(`${JIKAN_BASE_URL}/anime/${id}/characters-staff`);
      const rawChars = charRes?.characters;

      if (Array.isArray(rawChars) && rawChars.length > 0) {
        const mapped = rawChars.map(mapCharacter).filter(Boolean);
        const enriched = {
          ...existing,
          characters: mapped,
          characters_updated_at: new Date().toISOString(),
        };
        await Storage.saveAnimeDetails(id, enriched);
        successCount++;
        console.log(`✓ (${mapped.length} personajes)`);
      } else {
        console.log(`- Sin personajes disponibles`);
      }
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n==================================================`);
  console.log(`[CharSync] Finalizado: ${count} procesados, ${successCount} enriquecidos, ${errors} errores.`);
  console.log(`==================================================\n`);
}

if (process.argv[1]?.endsWith("characterSync.js")) {
  syncAnimeCharacters().catch((e) => {
    console.error("[CharSync] Error fatal:", e);
    process.exit(1);
  });
}
