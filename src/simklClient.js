import { config } from "./config.js";
import { Storage } from "./storage.js";

const SIMKL_CALENDAR_URL = "https://data.simkl.in/calendar/anime.json";
const FRIBB_MAPPING_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const SIMKL_IMG_BASE = "https://simkl.in/episodes/";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unescapeHtml(text) {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…");
}

export class SimklClient {
  constructor(clientId = config.simklClientId) {
    this.clientId = clientId;
    this.idMap = new Map(); // mal_id -> simkl_id
    this.isInitialized = false;
  }

  /**
   * Carga el mapeo masivo:
   * 1. Del archivo local en disco si ya existe (`mal_simkl_map.json`).
   * 2. Del calendario público de Simkl (`calendar/anime.json`, ~240 KB, sin API key).
   * 3. Si la base local está vacía, descarga la lista de Fribb y genera un mapa compacto (~350 KB).
   */
  async init() {
    if (this.isInitialized) return;

    console.log("[SimklClient] Inicializando mapa de IDs MyAnimeList <-> Simkl...");

    // 1. Cargar mapa persistido local si existe
    const localMap = await Storage.loadMalSimklMap();
    if (localMap && typeof localMap === "object") {
      for (const [malId, simklId] of Object.entries(localMap)) {
        const m = Number(malId);
        const s = Number(simklId);
        if (!isNaN(m) && !isNaN(s)) this.idMap.set(m, s);
      }
      console.log(`[SimklClient] ✓ ${this.idMap.size} mapeos cargados desde la base local.`);
    }

    // 2. Descargar calendario de Simkl (animes actuales en emisión, siempre fresco)
    try {
      console.log("[SimklClient] Consultando calendario de animes de Simkl (data.simkl.in)...");
      const res = await fetch(SIMKL_CALENDAR_URL, {
        headers: { "User-Agent": "AnimeHub-Collector/1.0" },
      });
      if (res.ok) {
        const calendarItems = await res.json();
        if (Array.isArray(calendarItems)) {
          let calendarCount = 0;
          for (const item of calendarItems) {
            const malId = Number(item.ids?.mal);
            const simklId = Number(item.ids?.simkl_id);
            if (!isNaN(malId) && !isNaN(simklId) && malId > 0 && simklId > 0) {
              this.idMap.set(malId, simklId);
              calendarCount++;
            }
          }
          await Storage.saveSimklCalendar(calendarItems);
          console.log(`[SimklClient] ✓ Calendario Simkl procesado (${calendarCount} animes activos mapeados).`);
        }
      }
    } catch (calError) {
      console.warn("[SimklClient] Advertencia al descargar calendario de Simkl:", calError.message);
    }

    // 3. Si la base local es pequeña (< 1000 items), descargar la base histórica de Fribb
    if (this.idMap.size < 1000) {
      try {
        console.log("[SimklClient] Descargando índice de mapeo global de Fribb (anime-lists)...");
        const fribbRes = await fetch(FRIBB_MAPPING_URL, {
          headers: { "User-Agent": "AnimeHub-Collector/1.0" },
        });
        if (fribbRes.ok) {
          const fribbList = await fribbRes.json();
          if (Array.isArray(fribbList)) {
            let fribbCount = 0;
            for (const item of fribbList) {
              const malId = Number(item.mal_id);
              const simklId = Number(item.simkl_id);
              if (!isNaN(malId) && !isNaN(simklId) && malId > 0 && simklId > 0) {
                this.idMap.set(malId, simklId);
                fribbCount++;
              }
            }
            console.log(`[SimklClient] ✓ Índice global de Fribb procesado (${fribbCount} animes mapeados).`);
          }
        }
      } catch (fribbError) {
        console.warn("[SimklClient] Advertencia al descargar índice de Fribb:", fribbError.message);
      }
    }

    // Guardar el mapa consolidado en disco
    const mapObject = Object.fromEntries(this.idMap);
    await Storage.saveMalSimklMap(mapObject);
    console.log(`[SimklClient] Base de mapeo lista con ${this.idMap.size} animes indexados.`);

    this.isInitialized = true;
  }

  /**
   * Resuelve el simkl_id a partir del mal_id.
   * Si no está en el mapa, consulta la API oficial /search/id de Simkl.
   */
  async resolveSimklId(malId) {
    if (!this.isInitialized) await this.init();

    const id = Number(malId);
    if (this.idMap.has(id)) {
      return this.idMap.get(id);
    }

    // Fallback: Consulta directa a la API de búsqueda de Simkl
    if (!this.clientId) return null;

    try {
      await sleep(config.collector.simklRequestDelayMs);
      const url = `https://api.simkl.com/search/id?mal=${id}&client_id=${this.clientId}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "AnimeHub-Collector/1.0",
          "Accept": "application/json",
          "simkl-api-key": this.clientId,
        },
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          const simklId = Number(item.ids?.simkl || item.ids?.simkl_id);
          if (!isNaN(simklId) && simklId > 0) {
            this.idMap.set(id, simklId);
            return simklId;
          }
        }
      }
    } catch (err) {
      console.warn(`[SimklClient] Error al resolver ID de Simkl para MAL ID ${malId}:`, err.message);
    }

    return null;
  }

  /**
   * Descarga la lista de episodios para un simkl_id y la transforma
   * al formato exacto y limpio que requiere Android TV.
   */
  async fetchEpisodes(simklId) {
    if (!simklId || !this.clientId) return { episodes: [], specials: [] };

    try {
      await sleep(config.collector.simklRequestDelayMs);
      const url = `https://api.simkl.com/anime/episodes/${simklId}?client_id=${this.clientId}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "AnimeHub-Collector/1.0",
          "Accept": "application/json",
          "simkl-api-key": this.clientId,
        },
      });

      if (!res.ok) {
        console.warn(`[SimklClient] Error HTTP ${res.status} al consultar episodios para Simkl ID ${simklId}`);
        return { episodes: [], specials: [] };
      }

      const list = await res.json();
      if (!Array.isArray(list)) return { episodes: [], specials: [] };

      const episodes = [];
      const specials = [];

      for (const item of list) {
        if (!item || typeof item !== "object") continue;

        const epNum = Number(item.episode);
        if (isNaN(epNum) || epNum <= 0) continue;

        const rawType = (item.type || "").toLowerCase().trim();
        const isSpecial = ["special", "extra", "ova", "movie"].includes(rawType);

        const cleanTitle = unescapeHtml(item.title) || (isSpecial ? `Especial ${epNum}` : `Episodio ${epNum}`);
        const cleanDesc = unescapeHtml(item.description) || null;
        const dateStr = (typeof item.date === "string" && item.date.trim()) || 
                        (typeof item.aired === "string" && item.aired.trim()) || null;

        // Construir URL completa de la miniatura en formato panorámico WebP
        let thumbUrl = null;
        const rawImg = item.img || item.poster || item.thumbnail || item.image || null;
        if (rawImg && typeof rawImg === "string" && rawImg.toLowerCase() !== "null") {
          const cleanHash = rawImg.replace(/^\/+/, "").trim();
          thumbUrl = `${SIMKL_IMG_BASE}${cleanHash}_w.webp`;
        }

        const episodePayload = {
          episode: epNum,
          episodeNumber: epNum,
          title: cleanTitle,
          aired: dateStr,
          airedDate: dateStr,
          thumbnail: thumbUrl,
          imageUrl: thumbUrl,
          description: cleanDesc,
        };

        if (isSpecial) {
          specials.push(episodePayload);
        } else {
          episodes.push(episodePayload);
        }
      }

      // Ordenar por número de episodio
      episodes.sort((a, b) => a.episode - b.episode);
      specials.sort((a, b) => a.episode - b.episode);

      return { episodes, specials };
    } catch (err) {
      console.warn(`[SimklClient] Error al descargar episodios para Simkl ID ${simklId}:`, err.message);
      return { episodes: [], specials: [] };
    }
  }
}
