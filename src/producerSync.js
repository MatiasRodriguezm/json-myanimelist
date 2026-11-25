import { load } from "cheerio";
import { config } from "./config.js";
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

/**
 * Obtiene las 20 primeras compañías/productoras de anime según el ranking Most Favorited de MyAnimeList
 * y enriquece su imagen/metadata desde la API de Jikan del proyecto, guardando en data/producers.json.
 */
export async function fetchTopProducers(limit = TOP_PRODUCERS_LIMIT) {
  const ranked = await fetchMostFavoritedIds();

  const items = [];
  for (const base of ranked) {
    if (items.length >= limit) break;
    try {
      const detail = await fetchWithRetry(`${JIKAN_BASE_URL}/producers/${base.malId}`);
      const imageUrl = detail?.images?.jpg?.imageUrl || detail?.images?.jpg?.image_url || "";
      if (!imageUrl) continue;

      items.push({
        id: Number(base.malId),
        name: detail?.name || base.name,
        imageUrl,
        count: Number(detail?.count ?? base.count ?? 0),
        favorites: Number(detail?.favorites ?? 0),
        url: detail?.url || base.url || null,
      });
      console.log(`[ProducerSync] (${items.length}/${limit}) ${detail?.name || base.name} (favs: ${detail?.favorites ?? "?"})`);
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
      console.log(`[ProducerSync] Completado exitosamente (${items.length} compañías).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[ProducerSync] Error fatal:", err);
      process.exit(1);
    });
}
