import fs from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import { config } from "./config.js";
import { jikanToAnimeSummary } from "./mapper.js";
import { Storage } from "./storage.js";

const JIKAN_BASE_URL = (process.env.JIKAN_API_URL || "https://animejikanapi-7p32.onrender.com").replace(/\/+$/, "");
const MAL_COMPANY_RANKING_URL = "https://myanimelist.net/company";
const TOP_PRODUCERS_LIMIT = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, maxRetries = 3, timeoutMs = 30000, asText = false) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return asText ? await res.text() : await res.json();
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[ProducerSync] Intento ${attempt}/${maxRetries} falló para ${url}: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await sleep(2000 * attempt);
    }
  }
}

async function fetchMostFavoritedIds() {
  try {
    console.log(`[ProducerSync] Obteniendo ranking Most Favorited desde ${MAL_COMPANY_RANKING_URL}...`);
    const html = await fetchWithRetry(MAL_COMPANY_RANKING_URL, 3, 30000, true);
    const doc = load(html);
    const ranked = [];
    const seen = new Set();

    doc('tr.ranking-list a[href*="/anime/producer/"], a[href*="/anime/producer/"]').each((_, el) => {
      const href = doc(el).attr("href") || "";
      const match = href.match(/\/anime\/producer\/(\d+)\//);
      if (!match) return;
      const malId = Number(match[1]);
      if (!malId || seen.has(malId)) return;

      const text = doc(el).text().trim();
      if (!text) return;

      seen.add(malId);
      ranked.push({ malId, name: text });
    });

    if (ranked.length >= TOP_PRODUCERS_LIMIT) {
      console.log(`[ProducerSync] Ranking Most Favorited obtenido: ${ranked.length} compañías.`);
      return ranked;
    }
  } catch (err) {
    console.warn(`[ProducerSync] No se pudo obtener ranking de MAL (${err.message}), usando fallback de Jikan...`);
  }

  const listData = await fetchWithRetry(`${JIKAN_BASE_URL}/producers`);
  const allProducers = Array.isArray(listData?.producers) ? listData.producers : [];
  return [...allProducers]
    .filter((p) => p && p.malId && p.name)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (a.malId || 0) - (b.malId || 0));
}

async function buildProducerAnimeCatalog(producer, detail) {
  const seenIds = new Set();
  const rawResults = Array.isArray(detail?.results) ? detail.results : [];
  const animeItems = [];

  for (const raw of rawResults) {
    const summary = jikanToAnimeSummary(raw);
    if (!summary || !summary.id || seenIds.has(summary.id)) continue;
    seenIds.add(summary.id);

    const existing = await Storage.loadAnimeDetails(summary.id);
    if (existing) {
      if (existing.status) summary.status = existing.status;
      if (existing.season) summary.season = existing.season;
      if (existing.year) summary.year = existing.year;
      if (existing.start_season) summary.start_season = existing.start_season;
      if (existing.averageEpisodeDurationSeconds != null) {
        summary.averageEpisodeDurationSeconds = existing.averageEpisodeDurationSeconds;
      }
      if (existing.average_episode_duration != null) {
        summary.average_episode_duration = existing.average_episode_duration;
      }
      if (existing.episodes != null) summary.episodes = existing.episodes;
      if (existing.num_episodes != null) summary.num_episodes = existing.num_episodes;
      if (Array.isArray(existing.genres) && existing.genres.length > 0) summary.genres = existing.genres;
      if (Array.isArray(existing.studios) && existing.studios.length > 0) summary.studios = existing.studios;
      if (existing.broadcast) summary.broadcast = existing.broadcast;
      if (existing.backdrop_url) summary.backdrop_url = existing.backdrop_url;
      if (existing.logo_url) summary.logo_url = existing.logo_url;
      if (existing.synopsis_es) summary.synopsis_es = existing.synopsis_es;
      if (existing.tmdb_id) summary.tmdb_id = existing.tmdb_id;
      if (existing.simkl_id) summary.simkl_id = existing.simkl_id;
    }

    animeItems.push(summary);
  }

  // Ordenar por score descendente (y por cantidad de usuarios como desempate)
  animeItems.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.numListUsers || 0) - (a.numListUsers || 0));

  const output = {
    id: producer.id,
    name: producer.name,
    count: producer.count || animeItems.length,
    hasNextPage: false,
    lastVisiblePage: 1,
    items: animeItems,
    updatedAt: new Date().toISOString(),
  };

  const destFile = path.join(config.paths.producersDir, `${producer.id}.json`);
  await Storage.writeJsonAtomic(destFile, output);
  console.log(`[ProducerSync]   -> ${producer.name} (${producer.id}.json): ${animeItems.length} animes (top1: ${animeItems[0]?.title || "-"} score=${animeItems[0]?.score ?? "-"})`);
}

/**
 * Obtiene las 20 primeras compañías/productoras de anime según el ranking Most Favorited de MyAnimeList,
 * guarda el listado en data/producers.json y genera data/producers/{id}.json con sus animes ordenados por score.
 */
export async function fetchTopProducers(limit = TOP_PRODUCERS_LIMIT) {
  await fs.mkdir(config.paths.producersDir, { recursive: true });
  const ranked = await fetchMostFavoritedIds();

  const items = [];
  for (const base of ranked) {
    if (items.length >= limit) break;
    try {
      const detail = await fetchWithRetry(`${JIKAN_BASE_URL}/producers/${base.malId}`);
      const imageUrl = detail?.images?.jpg?.imageUrl || detail?.images?.jpg?.image_url || "";
      if (!imageUrl) continue;

      const producer = {
        id: Number(base.malId),
        name: detail?.name || base.name,
        imageUrl,
        count: Number(detail?.count ?? base.count ?? 0),
        favorites: Number(detail?.favorites ?? 0),
        url: detail?.url || base.url || null,
      };
      items.push(producer);
      console.log(`[ProducerSync] (${items.length}/${limit}) ${producer.name} (favs: ${producer.favorites})`);
      await buildProducerAnimeCatalog(producer, detail);
      await sleep(250);
    } catch (err) {
      console.warn(`[ProducerSync] Error obteniendo detalle de productor ${base.malId}: ${err.message}`);
    }
  }

  const payload = {
    totalCount: items.length,
    items,
    updatedAt: new Date().toISOString(),
  };

  await Storage.writeJsonAtomic(config.paths.producersJson, payload);
  console.log(`[ProducerSync] ✓ producers.json guardado con ${items.length} compañías.`);

  return items;
}

if (process.argv[1]?.endsWith("producerSync.js")) {
  fetchTopProducers()
    .then((items) => {
      console.log(`[ProducerSync] Completado exitosamente (${items.length} compañías y sus catálogos).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[ProducerSync] Error fatal:", err);
      process.exit(1);
    });
}
