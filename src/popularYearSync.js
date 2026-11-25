import { config } from "./config.js";
import { getPopularYearTarget } from "./constants.js";
import { jikanToAnimeSummary } from "./mapper.js";
import { Storage } from "./storage.js";

const JIKAN_SEARCH_URL = "https://animejikanapi-7p32.onrender.com/anime/search";

/**
 * Realiza fetch con reintentos y timeout para soportar posibles cold-starts de Render.
 */
async function fetchWithRetry(url, maxRetries = 3, timeoutMs = 30000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[PopularYearSync] Intento ${attempt}/${maxRetries} falló para ${url}: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Recolecta los 100 animes más populares del año objetivo.
 * Regla: Al 4to mes (abril) del próximo año se cambia el año, manteniéndose hasta marzo del año siguiente.
 */
export async function fetchPopularYearAnime(specifiedYear = null) {
  const targetYear = specifiedYear || getPopularYearTarget();
  const title = `Animes Más Populares ${targetYear}`;
  console.log(`[PopularYearSync] Obteniendo 100 animes para "${title}" (Año: ${targetYear})...`);

  const rawResults = [];
  // Cada página retorna 50 resultados; 2 páginas alcanzan los 100 requeridos (o hasta 4 si fueran de 25)
  for (let page = 1; page <= 4 && rawResults.length < 100; page++) {
    try {
      const url = `${JIKAN_SEARCH_URL}?year=${targetYear}&order_by=popularity&page=${page}`;
      const data = await fetchWithRetry(url);
      const items = data.results || [];
      if (items.length === 0) break;
      rawResults.push(...items);
      console.log(`[PopularYearSync] Página ${page}: ${items.length} animes obtenidos.`);
      if (rawResults.length >= 100 || !data.hasNextPage) break;
    } catch (err) {
      console.error(`[PopularYearSync] Error obteniendo página ${page}:`, err.message);
      break;
    }
  }

  // Tomar hasta 100 animes únicos
  const seenIds = new Set();
  const popularAnime = [];

  for (const raw of rawResults) {
    const summary = jikanToAnimeSummary(raw);
    if (!summary || !summary.id || seenIds.has(summary.id)) continue;
    seenIds.add(summary.id);

    // Si ya existe en disco con enriquecimiento (TMDb backdrop, logo, synopsis_es), combinarlo
    const existing = await Storage.loadAnimeDetails(summary.id);
    if (existing) {
      if (existing.backdrop_url) summary.backdrop_url = existing.backdrop_url;
      if (existing.logo_url) summary.logo_url = existing.logo_url;
      if (existing.synopsis_es) summary.synopsis_es = existing.synopsis_es;
      if (existing.tmdb_id) summary.tmdb_id = existing.tmdb_id;
      if (existing.simkl_id) summary.simkl_id = existing.simkl_id;
      if ((!summary.genres || summary.genres.length === 0) && Array.isArray(existing.genres) && existing.genres.length > 0) {
        summary.genres = existing.genres;
      }
    }

    popularAnime.push(summary);
    if (popularAnime.length >= 100) break;
  }

  const payload = {
    year: targetYear,
    title,
    totalCount: popularAnime.length,
    items: popularAnime,
    updatedAt: new Date().toISOString(),
  };

  // Guardar archivo independiente en el CDN
  await Storage.writeJsonAtomic(config.paths.popularYearJson, payload);
  console.log(`[PopularYearSync] ✓ popular_year.json guardado con ${popularAnime.length} animes.`);

  return {
    targetYear,
    title,
    popularAnime,
  };
}

// Ejecución directa opcional: node src/popularYearSync.js
if (process.argv[1]?.endsWith("popularYearSync.js")) {
  fetchPopularYearAnime()
    .then((res) => {
      console.log(`[PopularYearSync] Completado exitosamente: ${res.title} (${res.popularAnime.length} items)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[PopularYearSync] Error fatal:", err);
      process.exit(1);
    });
}
