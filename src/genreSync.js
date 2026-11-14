import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { Storage } from "./storage.js";

const JIKAN_BASE_URL = process.env.JIKAN_API_URL || "https://animejikanapi-7p32.onrender.com";
const DELAY_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSeasonAndYear(airingStart) {
  if (!airingStart) return { season: null, year: null };
  const date = new Date(airingStart);
  if (isNaN(date.getTime())) return { season: null, year: null };

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1 - 12
  let season = null;
  if (month >= 1 && month <= 3) season = "winter";
  else if (month >= 4 && month <= 6) season = "spring";
  else if (month >= 7 && month <= 9) season = "summer";
  else season = "fall";

  return { season, year };
}

function mapJikanToAnimeSummary(item) {
  const malId = item.malId;
  const imgUrl = item.images?.jpg?.largeImageUrl || item.images?.jpg?.imageUrl || null;
  const { season, year } = parseSeasonAndYear(item.airingStart);

  const genres = [
    ...(Array.isArray(item.genres) ? item.genres : []),
    ...(Array.isArray(item.explicitGenres) ? item.explicitGenres : []),
    ...(Array.isArray(item.themes) ? item.themes : []),
    ...(Array.isArray(item.demographics) ? item.demographics : []),
  ].map((g) => ({
    name: g.name,
    id: g.url ? Number(g.url.match(/\/genre\/(\d+)\//)?.[1] || null) : null,
  }));

  const studios = Array.isArray(item.producers)
    ? item.producers.map((p) => ({
        name: p.name,
        id: p.url ? Number(p.url.match(/\/producer\/(\d+)\//)?.[1] || null) : null,
      }))
    : [];

  return {
    id: malId,
    mal_id: malId,
    title: item.title,
    englishTitle: null,
    title_english: null,
    synopsis: item.synopsis || null,
    type: item.type || null,
    media_type: item.type || null,
    status: null,
    season: season,
    year: year,
    episodes: item.episodes || null,
    num_episodes: item.episodes || null,
    score: item.score != null ? Number(item.score) : null,
    mean: item.score != null ? Number(item.score) : null,
    numListUsers: item.members || null,
    num_list_users: item.members || null,
    genres: genres,
    studios: studios,
    pictures: imgUrl ? [imgUrl] : [],
    backdrop_url: null,
    logo_url: null,
    images: {
      jpg: {
        imageUrl: imgUrl,
        largeImageUrl: imgUrl,
        image_url: imgUrl,
        large_image_url: imgUrl,
      },
    },
  };
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AnimeHub-Catalog-Sync/1.0" },
      });
      if (res.ok) {
        return await res.json();
      }
      console.warn(`[GenreSync] HTTP ${res.status} al consultar ${url} (Intento ${attempt}/${maxRetries})`);
    } catch (err) {
      console.warn(`[GenreSync] Error de red en ${url}: ${err.message} (Intento ${attempt}/${maxRetries})`);
    }
    await sleep(attempt * 1500);
  }
  return null;
}

export async function syncGenresAndThemes() {
  console.log(`\n==================================================`);
  console.log(`[GenreSync] Sincronizando Géneros y Temáticas desde ${JIKAN_BASE_URL}`);
  console.log(`==================================================`);

  await Storage.initDirectories();
  const genresDir = config.paths.genres;
  const themesDir = config.paths.themes;
  await fs.mkdir(genresDir, { recursive: true });
  await fs.mkdir(themesDir, { recursive: true });

  console.log(`[GenreSync] Obteniendo lista de categorías desde /genres/anime...`);
  const meta = await fetchWithRetry(`${JIKAN_BASE_URL}/genres/anime`);
  if (!meta || (!meta.genres && !meta.themes)) {
    console.error(`[GenreSync] No se pudo obtener el índice de géneros/temas de la API.`);
    return;
  }

  const allGenres = [...(meta.genres || []), ...(meta.explicit_genres || [])];
  const allThemes = meta.themes || [];

  console.log(`[GenreSync] Categorías encontradas: ${allGenres.length} géneros y ${allThemes.length} temáticas.`);

  // 1. Procesar Géneros
  for (let i = 0; i < allGenres.length; i++) {
    const item = allGenres[i];
    const malId = item.malId;
    const name = item.name;
    const destFile = path.join(genresDir, `${malId}.json`);

    process.stdout.write(`[GenreSync] [Género ${i + 1}/${allGenres.length}] ID ${malId} (${name})... `);
    const data = await fetchWithRetry(`${JIKAN_BASE_URL}/genres/anime/${malId}`);

    if (data && Array.isArray(data.results)) {
      const mappedItems = data.results.map(mapJikanToAnimeSummary);
      const output = {
        id: malId,
        name: name,
        count: data.count || mappedItems.length,
        hasNextPage: Boolean(data.hasNextPage),
        lastVisiblePage: data.lastVisiblePage || 1,
        items: mappedItems,
        updatedAt: new Date().toISOString(),
      };
      await Storage.writeJsonAtomic(destFile, output);
      console.log(`✓ (${mappedItems.length} animes guardados)`);
    } else {
      console.log(`✗ Falló la descarga`);
    }

    await sleep(DELAY_MS);
  }

  // 2. Procesar Temáticas
  for (let i = 0; i < allThemes.length; i++) {
    const item = allThemes[i];
    const malId = item.malId;
    const name = item.name;
    const destFile = path.join(themesDir, `${malId}.json`);

    process.stdout.write(`[GenreSync] [Tema ${i + 1}/${allThemes.length}] ID ${malId} (${name})... `);
    const data = await fetchWithRetry(`${JIKAN_BASE_URL}/genres/anime/${malId}`);

    if (data && Array.isArray(data.results)) {
      const mappedItems = data.results.map(mapJikanToAnimeSummary);
      const output = {
        id: malId,
        name: name,
        count: data.count || mappedItems.length,
        hasNextPage: Boolean(data.hasNextPage),
        lastVisiblePage: data.lastVisiblePage || 1,
        items: mappedItems,
        updatedAt: new Date().toISOString(),
      };
      await Storage.writeJsonAtomic(destFile, output);
      console.log(`✓ (${mappedItems.length} animes guardados)`);
    } else {
      console.log(`✗ Falló la descarga`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n==================================================`);
  console.log(`[GenreSync] ¡Sincronización de Géneros y Temáticas finalizada con éxito!`);
  console.log(`==================================================\n`);
}

// Si se ejecuta directamente vía CLI: node src/genreSync.js
if (process.argv[1]?.endsWith("genreSync.js")) {
  syncGenresAndThemes().catch((e) => {
    console.error("[GenreSync] Error fatal:", e);
    process.exit(1);
  });
}
