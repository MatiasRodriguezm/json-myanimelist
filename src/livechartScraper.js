import * as cheerio from "cheerio";
import { config } from "./config.js";
import { Storage } from "./storage.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15000;
const MAL_ID_REGEX = /myanimelist\.net\/(?:anime\/(\d+)|anime\.php\?id=(\d+))/i;

const EPISODE_REGEX = /(?:episode|ep(?:isode)?\.?|#)\s*[:#-]?\s*(\d+)/i;
const ALL_EPS_REGEX = /All\s+(\d+)\s*EPs?/i;
const LARGE_IMG_REGEX = /(\S+large\.\w+)/;
const PROG_RANGES_REGEX = /\[\s*\d+\s*,\s*(?:true|false)\s*,\s*(?:true|false)\s*,\s*(\d+)\s*,\s*(\d+)/g;
const RANGE_TEXT_REGEX = /(?:EPs?|Episodes?)\s*(\d+)\s*[-~–—]\s*(\d+)/i;
const PAIR_REGEX = /\[\s*(\d+)\s*,\s*(\d+)\s*\]/g;
const SINGLE_REGEX = /\[\s*(\d+)\s*\]/g;

/**
 * Parsea los números de episodios de un bloque de horario de LiveChart.
 * Réplica exacta de la lógica probada en LiveChartRepository.kt de Android TV.
 */
export function parseEpisodesFromScheduleBlock(rangesAttr = "", labelText = "") {
  const results = [];

  if (rangesAttr && rangesAttr.trim().length > 0) {
    const progMatches = [...rangesAttr.matchAll(PROG_RANGES_REGEX)];
    if (progMatches.length > 0) {
      for (const m of progMatches) {
        const start = parseInt(m[1], 10);
        const end = parseInt(m[2], 10);
        if (!isNaN(start) && !isNaN(end) && start <= end && end - start < 150) {
          for (let ep = start; ep <= end; ep++) results.push(ep);
        } else if (!isNaN(start)) {
          results.push(start);
        }
      }
    } else {
      const pairMatches = [...rangesAttr.matchAll(PAIR_REGEX)];
      if (pairMatches.length > 0) {
        for (const m of pairMatches) {
          const start = parseInt(m[1], 10);
          const end = parseInt(m[2], 10);
          if (!isNaN(start) && !isNaN(end) && start <= end && end - start < 150) {
            for (let ep = start; ep <= end; ep++) results.push(ep);
          } else if (!isNaN(start)) {
            results.push(start);
          }
        }
      } else {
        const singleMatches = [...rangesAttr.matchAll(SINGLE_REGEX)];
        for (const m of singleMatches) {
          const ep = parseInt(m[1], 10);
          if (!isNaN(ep)) results.push(ep);
        }
      }
    }
  }

  if (results.length > 0) {
    return [...new Set(results)];
  }

  const allEpsMatch = labelText.match(ALL_EPS_REGEX);
  if (allEpsMatch) {
    const total = parseInt(allEpsMatch[1], 10);
    if (!isNaN(total) && total >= 1 && total <= 200) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
  }

  const rangeMatch = labelText.match(RANGE_TEXT_REGEX);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isNaN(start) && !isNaN(end) && start <= end && end - start < 150) {
      const arr = [];
      for (let i = start; i <= end; i++) arr.push(i);
      return arr;
    }
  }

  const singleMatch = labelText.match(EPISODE_REGEX);
  if (singleMatch) {
    const ep = parseInt(singleMatch[1], 10);
    if (!isNaN(ep)) return [ep];
  }

  return [1];
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al consultar ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Precarga mapeos liveChartId -> malId desde las páginas de temporada de LiveChart.
 */
export async function preloadSeasonMappings(existingMap = {}) {
  const map = { ...existingMap };
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const currentSeason =
    month <= 3 ? "winter" : month <= 6 ? "spring" : month <= 9 ? "summer" : "fall";
  const prevSeason =
    currentSeason === "winter"
      ? { season: "fall", year: year - 1 }
      : currentSeason === "spring"
      ? { season: "winter", year }
      : currentSeason === "summer"
      ? { season: "spring", year }
      : { season: "summer", year };

  const seasonsToFetch = [
    `${currentSeason}-${year}`,
    `${prevSeason.season}-${prevSeason.year}`,
  ];

  for (const seasonSlug of seasonsToFetch) {
    try {
      const url = `https://www.livechart.me/${seasonSlug}/all`;
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      const cards = $(".anime-card, article.lc-anime-card-abs, article.lc-anime-details-card, article");

      cards.each((_, el) => {
        const card = $(el);
        const lcHref = card.find('a[href^="/anime/"]').first().attr("href");
        const lcId = lcHref ? parseInt(lcHref.split("/")[2], 10) : null;
        if (!lcId) return;

        let malId = null;
        card.find('.related-links a, a[href*="myanimelist.net"]').each((_, a) => {
          const href = $(a).attr("href") || "";
          const m = href.match(MAL_ID_REGEX);
          if (m) {
            malId = parseInt(m[1] || m[2], 10);
          }
        });

        if (malId) {
          map[lcId] = malId;
        }
      });
    } catch (err) {
      console.warn(`[LiveChartScraper] Advertencia al precargar ${seasonSlug}:`, err.message);
    }
  }

  return map;
}

/**
 * Resuelve el malId de un anime individual si aún no está mapeado.
 */
async function resolveSingleMalId(liveChartId) {
  try {
    const url = `https://www.livechart.me/anime/${liveChartId}`;
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    let malId = null;
    $('.related-links a, a[href*="myanimelist.net"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(MAL_ID_REGEX);
      if (m) {
        malId = parseInt(m[1] || m[2], 10);
      }
    });
    return malId;
  } catch {
    return null;
  }
}

/**
 * Ejecuta el scraping de los días anteriores de LiveChart y genera livechart_past_schedule.json.
 * @param {number} daysBack Cantidad de días hacia atrás a cubrir (por defecto 14 días).
 */
export async function syncLiveChart(daysBack = 14) {
  console.log(`\n==================================================`);
  console.log(`[LiveChartScraper] Iniciando recolección de días anteriores: ${new Date().toISOString()}`);
  console.log(`==================================================`);

  await Storage.initDirectories();

  // 1. Cargar mapeos de MAL previos y enriquecer con temporadas actuales
  let malMap = await Storage.loadLiveChartMalMap();
  console.log(`[LiveChartScraper] Mapeos previos en base: ${Object.keys(malMap).length}`);
  malMap = await preloadSeasonMappings(malMap);
  console.log(`[LiveChartScraper] Mapeos totales tras precarga de temporadas: ${Object.keys(malMap).length}`);

  // 2. Cargar historial anterior para combinar
  const previousData = (await Storage.loadLiveChartSchedule()) || { days: {} };
  const mergedDays = { ...(previousData.days || {}) };

  const now = new Date();
  const todayIso = now.toISOString().split("T")[0]; // YYYY-MM-DD UTC
  console.log(`[LiveChartScraper] Fecha actual de referencia: ${todayIso} (Solo se guardan días estrictamente anteriores)`);

  // 3. Consultar las últimas 2 semanas (semana -7 días y semana -14 días)
  // 3. Consultar la semana actual (0) y las 2 semanas anteriores (7 y 14)
  const targetOffsets = [0, 7, 14];
  const fetchedDayCount = new Set();

  for (const offset of targetOffsets) {
    const targetDate = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const dateQuery = targetDate.toISOString().split("T")[0];
    const url = `https://www.livechart.me/schedule?date=${dateQuery}`;
    console.log(`[LiveChartScraper] Consultando bloque de semana: ${url}`);

    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      const dayCols = $(".lc-timetable-day:not(.lc-placeholder)");

      dayCols.each((_, colEl) => {
        const col = $(colEl);
        const startSec = col.attr("data-timetable-day-start");
        if (!startSec) return;

        const dayDate = new Date(Number(startSec) * 1000);
        const dateStr = dayDate.toISOString().split("T")[0];

        // CONDICIÓN ESTRICTA: Solo días anteriores a la fecha actual
        // Conservar todos los dias de la semana

        const blocks = col.find(".lc-timetable-anime-block");
        const items = [];

        blocks.each((_, blockEl) => {
          const block = $(blockEl);
          const rawId =
            block.attr("data-anime-item-id") ||
            block.attr("data-schedule-anime-id") ||
            block.find('a[href^="/anime/"]').first().attr("href")?.split("/")[2];
          const liveChartId = parseInt(rawId, 10);
          if (!liveChartId || isNaN(liveChartId)) return;

          const title =
            block.attr("data-anime-item-romanized-native-title") ||
            block.attr("data-schedule-anime-title") ||
            block.find(".lc-timetable-anime-block__title").attr("title") ||
            block.find(".lc-timetable-anime-block__title").text().trim() ||
            block.find(".lc-tt-anime-title").text().trim() ||
            "Sin título";

          const rawTs =
            block.attr("data-schedule-anime-release-date-value") ||
            block.find("time[data-timestamp]").attr("data-timestamp") ||
            block.parents("[data-timestamp]").attr("data-timestamp");
          let timestampMs = rawTs ? Number(rawTs) : dayDate.getTime();
          if (timestampMs < 10000000000) timestampMs *= 1000;

          const ranges =
            block.find("[data-viewing-progression-episode-ranges-value]").attr("data-viewing-progression-episode-ranges-value") ||
            block.attr("data-schedule-anime-ranges") ||
            "";
          const labelText = [
            block.find(".lc-timetable-anime-block__label").text(),
            block.find(".lc-tt-release-label").text(),
            block.text(),
          ]
            .filter(Boolean)
            .join(" ");

          const parsedEpisodes = parseEpisodesFromScheduleBlock(ranges, labelText);

          const img = block.find("img.lc-timetable-anime-block__poster, img.lc-tt-poster, img");
          const srcset = img.attr("srcset") || "";
          const src = img.attr("src") || "";
          const largeMatch = srcset.match(LARGE_IMG_REGEX);
          const posterUrl = largeMatch ? largeMatch[1] : src || "";

          for (const ep of parsedEpisodes) {
            items.push({
              liveChartId,
              live_chart_id: liveChartId,
              malId: malMap[liveChartId] || null,
              mal_id: malMap[liveChartId] || null,
              title,
              episode: ep,
              timestampMs,
              timestamp_ms: timestampMs,
              posterUrl,
              poster_url: posterUrl,
            });
          }
        });

        // Ordenar los episodios del día por hora de emisión descendente
        items.sort((a, b) => b.timestampMs - a.timestampMs || b.episode - a.episode);

        mergedDays[dateStr] = items;
        fetchedDayCount.add(dateStr);
      });
    } catch (err) {
      console.warn(`[LiveChartScraper] Error al consultar bloque ${dateQuery}:`, err.message);
    }
  }

  // 4. Intentar resolver MAL IDs faltantes (límite de 15 por ciclo para no saturar)
  const unmappedLiveChartIds = new Set();
  for (const dayItems of Object.values(mergedDays)) {
    for (const item of dayItems) {
      if (!item.malId && !malMap[item.liveChartId]) {
        unmappedLiveChartIds.add(item.liveChartId);
      }
    }
  }

  if (unmappedLiveChartIds.size > 0) {
    console.log(`[LiveChartScraper] Resolviendo ${Math.min(unmappedLiveChartIds.size, 15)} IDs pendientes en LiveChart...`);
    let resolvedCount = 0;
    for (const lcId of [...unmappedLiveChartIds].slice(0, 15)) {
      const resolvedMalId = await resolveSingleMalId(lcId);
      if (resolvedMalId) {
        malMap[lcId] = resolvedMalId;
        resolvedCount++;
      }
    }
    console.log(`[LiveChartScraper] Se resolvieron ${resolvedCount} nuevos mapeos de MyAnimeList.`);

    // Reasignar los malId resueltos a los items existentes
    for (const dayItems of Object.values(mergedDays)) {
      for (const item of dayItems) {
        if (!item.malId && malMap[item.liveChartId]) {
          item.malId = malMap[item.liveChartId];
        }
      }
    }
  }

  // 5. Podar días anteriores a daysBack (ej: mantener los últimos 21 días como máximo)
  const cutoffDate = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const finalDays = {};
  const sortedDates = Object.keys(mergedDays)
    .filter((d) => d >= cutoffDate)
    .sort()
    .reverse();

  for (const d of sortedDates) {
    finalDays[d] = mergedDays[d];
  }

  const payload = {
    updatedAt: new Date().toISOString(),
    daysCount: Object.keys(finalDays).length,
    startDate: sortedDates[sortedDates.length - 1] || null,
    endDate: sortedDates[0] || null,
    days: finalDays,
    malMapping: malMap,
  };

  // 6. Guardar en disco
  await Storage.saveLiveChartSchedule(payload);
  await Storage.saveLiveChartMalMap(malMap);

  console.log(`[LiveChartScraper] ✓ livechart_past_schedule.json guardado con éxito.`);
  console.log(`[LiveChartScraper] Días procesados en el archivo: ${Object.keys(finalDays).length} días (desde ${payload.startDate} hasta ${payload.endDate}).`);

  return payload;
}

// Ejecución directa desde línea de comandos (ej: node src/livechartScraper.js)
if (process.argv[1]?.endsWith("livechartScraper.js")) {
  syncLiveChart()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[LiveChartScraper] Error fatal:", err);
      process.exit(1);
    });
}
