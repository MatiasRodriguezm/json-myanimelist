import { config } from "./config.js";
import { DETAIL_FIELDS, LIST_FIELDS } from "./constants.js";

const BASE_URL = "https://api.myanimelist.net/v2";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MalClient {
  constructor(clientId = config.malClientId) {
    this.clientId = clientId;
  }

  async fetchWithRetry(url, options = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            "X-MAL-CLIENT-ID": this.clientId,
            "User-Agent": "AnimeHub-Catalog-Service/1.0",
            Accept: "application/json",
            ...(options.headers || {}),
          },
          signal: AbortSignal.timeout(25_000),
        });

        if (response.status === 429) {
          const waitTime = Math.min(attempt * 2000, 10000);
          console.warn(`[MAL API] Rate limited (429). Esperando ${waitTime}ms (intento ${attempt}/${retries})...`);
          await sleep(waitTime);
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`MAL respondió ${response.status}: ${text || response.statusText}`);
        }

        const data = await response.json();
        // Pausa ligera para mantener la cuota segura
        await sleep(config.collector.requestDelayMs);
        return data;
      } catch (err) {
        if (attempt === retries) throw err;
        const waitTime = attempt * 1500;
        console.warn(`[MAL API] Error en intento ${attempt}: ${err.message}. Reintentando en ${waitTime}ms...`);
        await sleep(waitTime);
      }
    }
  }

  /**
   * Obtiene ranking de anime (all, bypopularity, tv, movie, ova, upcoming, special)
   */
  async getAnimeRanking(rankingType = "all", limit = 50, offset = 0, fields = LIST_FIELDS) {
    const params = new URLSearchParams({
      ranking_type: rankingType,
      limit: String(limit),
      offset: String(offset),
      fields,
    });
    return this.fetchWithRetry(`${BASE_URL}/anime/ranking?${params.toString()}`);
  }

  /**
   * Obtiene animes de una temporada específica
   */
  async getSeasonalAnime(year, season, limit = 500, offset = 0, fields = LIST_FIELDS) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      fields,
      sort: "anime_num_list_users",
    });
    return this.fetchWithRetry(`${BASE_URL}/anime/season/${year}/${season}?${params.toString()}`);
  }

  /**
   * Obtiene la metadata detallada de un anime individual
   */
  async getAnimeDetails(animeId, fields = DETAIL_FIELDS) {
    const params = new URLSearchParams({ fields });
    return this.fetchWithRetry(`${BASE_URL}/anime/${animeId}?${params.toString()}`);
  }

  /**
   * Búsqueda general de animes por título
   */
  async searchAnime(query, limit = 20, fields = LIST_FIELDS) {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      fields,
    });
    return this.fetchWithRetry(`${BASE_URL}/anime?${params.toString()}`);
  }
}
