import { config } from "./config.js";
import { Storage } from "./storage.js";

const FRIBB_MAPPING_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const CLOUDFLARE_WORKER_API = "https://api-ids-animedatabase.elsodaestacio.workers.dev/api/anime/";
const ANI_ZIP_API = "https://api.ani.zip/mappings?mal_id=";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";
const TMDB_LOGO_BASE = "https://image.tmdb.org/t/p/w500";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTmdbObj(themoviedb_id, defaultIsMovie = false) {
  if (!themoviedb_id) return null;
  if (typeof themoviedb_id === "number" || typeof themoviedb_id === "string") {
    return { tmdbId: String(themoviedb_id), isMovie: defaultIsMovie };
  }
  if (typeof themoviedb_id === "object") {
    if (themoviedb_id.tv) {
      const tvId = Array.isArray(themoviedb_id.tv) ? themoviedb_id.tv[0] : themoviedb_id.tv;
      if (tvId) return { tmdbId: String(tvId), isMovie: false };
    }
    if (themoviedb_id.movie) {
      const movieId = Array.isArray(themoviedb_id.movie) ? themoviedb_id.movie[0] : themoviedb_id.movie;
      if (movieId) return { tmdbId: String(movieId), isMovie: true };
    }
  }
  return null;
}

export class TmdbClient {
  constructor(apiKey = config.tmdbApiKey, apiToken = config.tmdbApiToken) {
    this.apiKey = apiKey;
    this.apiToken = apiToken;
    this.idMap = new Map(); // mal_id -> { tmdbId: string, isMovie: boolean }
    this.isInitialized = false;
    this.hasUnsavedChanges = false;
  }

  /**
   * Carga el mapeo masivo:
   * 1. Del archivo local en disco si ya existe (`mal_tmdb_map.json`).
   * 2. Si la base local tiene pocos items (< 1000), descarga la lista global de Fribb y genera el índice.
   * 3. Complementa con el calendario local de Simkl si existe.
   */
  async init() {
    if (this.isInitialized) return;

    console.log("[TmdbClient] Inicializando mapa de IDs MyAnimeList <-> TheMovieDB...");

    // 1. Cargar mapa persistido local
    const localMap = await Storage.loadMalTmdbMap();
    if (localMap && typeof localMap === "object") {
      for (const [malId, entry] of Object.entries(localMap)) {
        const m = Number(malId);
        if (!isNaN(m) && entry?.tmdbId) {
          this.idMap.set(m, {
            tmdbId: String(entry.tmdbId),
            isMovie: Boolean(entry.isMovie),
          });
        }
      }
      console.log(`[TmdbClient] ✓ ${this.idMap.size} mapeos TMDb cargados desde base local.`);
    }

    // 2. Si la base local es pequeña, descargar base masiva de Fribb
    if (this.idMap.size < 1000) {
      try {
        console.log("[TmdbClient] Descargando índice de mapeo masivo de Fribb para TMDb...");
        const res = await fetch(FRIBB_MAPPING_URL, {
          headers: { "User-Agent": "AnimeHub-Collector/1.0" },
        });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            let fribbCount = 0;
            for (const item of list) {
              const malId = Number(item.mal_id);
              if (isNaN(malId) || malId <= 0) continue;
              const isMovieFromType = String(item.type || "").toLowerCase() === "movie";
              const parsed = parseTmdbObj(item.themoviedb_id, isMovieFromType);
              if (parsed && !this.idMap.has(malId)) {
                this.idMap.set(malId, parsed);
                fribbCount++;
              }
            }
            this.hasUnsavedChanges = true;
            console.log(`[TmdbClient] ✓ ${fribbCount} mapeos TMDb indexados desde Fribb.`);
          }
        }
      } catch (fribbErr) {
        console.warn("[TmdbClient] Advertencia al descargar índice Fribb:", fribbErr.message);
      }
    }

    // 3. Complementar con simkl_calendar.json si está disponible
    try {
      const calendarItems = await Storage.loadSimklCalendar();
      if (Array.isArray(calendarItems)) {
        let calCount = 0;
        for (const item of calendarItems) {
          const malId = Number(item.ids?.mal);
          const tmdbId = item.ids?.tmdb ? String(item.ids.tmdb) : null;
          if (malId > 0 && tmdbId && !this.idMap.has(malId)) {
            const isMovie = String(item.type || "").toLowerCase() === "movie";
            this.idMap.set(malId, { tmdbId, isMovie });
            calCount++;
            this.hasUnsavedChanges = true;
          }
        }
        if (calCount > 0) {
          console.log(`[TmdbClient] ✓ ${calCount} mapeos TMDb complementados desde calendario Simkl.`);
        }
      }
    } catch (calErr) {
      // Ignorar fallo secundario de calendario
    }

    await this.saveMapIfChanged();
    this.isInitialized = true;
  }

  async saveMapIfChanged() {
    if (!this.hasUnsavedChanges) return;
    try {
      const obj = {};
      for (const [malId, entry] of this.idMap) {
        obj[malId] = entry;
      }
      await Storage.saveMalTmdbMap(obj);
      this.hasUnsavedChanges = false;
      console.log(`[TmdbClient] ✓ Base local mal_tmdb_map.json guardada (${this.idMap.size} animes).`);
    } catch (saveErr) {
      console.warn("[TmdbClient] Error guardando mal_tmdb_map.json:", saveErr.message);
    }
  }

  /**
   * Resuelve el ID de TheMovieDB para un anime de MyAnimeList.
   * Orden de resolución:
   * 1. Mapa en memoria / local.
   * 2. Cloudflare Worker (api-ids-animedatabase.elsodaestacio.workers.dev).
   * 3. AniZip (api.ani.zip).
   */
  async resolveTmdbInfo(malId, mediaType = "tv") {
    const mId = Number(malId);
    if (isNaN(mId) || mId <= 0) return null;

    if (this.idMap.has(mId)) {
      return this.idMap.get(mId);
    }

    const isMovieHint = String(mediaType || "").toLowerCase().includes("movie");

    // 1. Consultar Cloudflare Worker del usuario
    try {
      const res = await fetch(`${CLOUDFLARE_WORKER_API}${mId}`, {
        headers: {
          "User-Agent": "AnimeHub-Collector/1.0",
          Accept: "application/json",
        },
      });
      if (res.ok) {
        const json = await res.json();
        const providers = json.data?.providers;
        const typeStr = json.data?.type || "";
        const isMovie = isMovieHint || typeStr.toLowerCase() === "movie";
        const parsed = parseTmdbObj(providers?.themoviedb_id, isMovie);
        if (parsed) {
          this.idMap.set(mId, parsed);
          this.hasUnsavedChanges = true;
          return parsed;
        }
      }
    } catch (workerErr) {
      // Continuar con AniZip fallback
    }

    // 2. Fallback a AniZip
    try {
      const res = await fetch(`${ANI_ZIP_API}${mId}`, {
        headers: {
          "User-Agent": "AnimeHub-Collector/1.0",
          Accept: "application/json",
        },
      });
      if (res.ok) {
        const json = await res.json();
        const tmdbId = json.mappings?.themoviedb_id;
        if (tmdbId) {
          const isMovie = isMovieHint || String(json.mappings?.type || "").toLowerCase() === "movie";
          const parsed = { tmdbId: String(tmdbId), isMovie };
          this.idMap.set(mId, parsed);
          this.hasUnsavedChanges = true;
          return parsed;
        }
      }
    } catch (zipErr) {
      // Fin de fallbacks
    }

    return null;
  }

  /**
   * Obtiene backdrops panorámicos (1080p) y clearlogos (PNG transparente) desde TheMovieDB.
   */
  async fetchAssets(tmdbId, isMovie = false) {
    if (!tmdbId) return { backdropUrl: null, logoUrl: null };

    const delayMs = config.collector?.tmdbRequestDelayMs || 150;
    const fetchEndpoint = async (endpoint) => {
      const url = `${TMDB_API_BASE}/${endpoint}/${tmdbId}?api_key=${this.apiKey}&append_to_response=images&include_image_language=en,ja,null`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
          "User-Agent": "AnimeHub-Collector/1.0",
        },
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        if (res.status === 429) {
          console.warn(`[TmdbClient] Rate limit 429 en TMDb para ID ${tmdbId}, pausando 1s...`);
          await sleep(1000);
          return null;
        }
        return null;
      }
      return await res.json();
    };

    let data = null;
    let endpointUsed = isMovie ? "movie" : "tv";

    try {
      data = await fetchEndpoint(endpointUsed);
      // Si dio 404, intentar el endpoint alternativo por si estaba catalogado al revés en TMDb
      if (!data) {
        endpointUsed = isMovie ? "tv" : "movie";
        data = await fetchEndpoint(endpointUsed);
      }
    } catch (netErr) {
      console.warn(`[TmdbClient] Error de red consultando TMDb para ID ${tmdbId}:`, netErr.message);
      return { backdropUrl: null, logoUrl: null };
    } finally {
      await sleep(delayMs);
    }

    if (!data) {
      return { backdropUrl: null, logoUrl: null };
    }

    // 1. Backdrop (1080p panorámico)
    const backdropUrl = data.backdrop_path ? `${TMDB_BACKDROP_BASE}${data.backdrop_path}` : null;

    // 2. ClearLogo (PNG transparente, priorizando inglés, luego japonés, luego cualquier otro)
    const logos = Array.isArray(data.images?.logos) ? data.images.logos : [];
    let enLogo = null;
    let jaLogo = null;
    let fallbackLogo = null;

    for (const logo of logos) {
      if (!logo.file_path) continue;
      const lang = String(logo.iso_639_1 || "").toLowerCase();
      if (!fallbackLogo) fallbackLogo = logo.file_path;
      if ((lang === "en" || lang === "en-us" || lang === "en-gb" || lang === "00") && !enLogo) {
        enLogo = logo.file_path;
      } else if ((lang === "ja" || lang === "ja-jp") && !jaLogo) {
        jaLogo = logo.file_path;
      }
      if (enLogo && jaLogo) break;
    }

    const selectedLogoPath = enLogo || jaLogo || fallbackLogo;
    const logoUrl = selectedLogoPath ? `${TMDB_LOGO_BASE}${selectedLogoPath}` : null;

    return { backdropUrl, logoUrl };
  }

  /**
   * Resuelve y descarga los assets de TMDb para un anime específico.
   */
  async getAssetsForAnime(malId, mediaType = "tv") {
    const tmdbInfo = await this.resolveTmdbInfo(malId, mediaType);
    if (!tmdbInfo || !tmdbInfo.tmdbId) {
      return { tmdbId: null, backdropUrl: null, logoUrl: null };
    }

    const { backdropUrl, logoUrl } = await this.fetchAssets(tmdbInfo.tmdbId, tmdbInfo.isMovie);
    return {
      tmdbId: tmdbInfo.tmdbId,
      backdropUrl,
      logoUrl,
    };
  }
}
