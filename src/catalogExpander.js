import { MalClient } from "./malClient.js";
import { Storage } from "./storage.js";
import { toAnimeSummary } from "./mapper.js";
import { config } from "./config.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateGtx(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();
  if (!clean) return null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(clean)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      if (res.status === 429) {
        await sleep(attempt * 2500);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((item) => (item && item[0] ? item[0] : "")).join("").trim();
      }
      return null;
    } catch {
      await sleep(attempt * 800);
    }
  }
  return null;
}

export async function expandTopCatalog(targetTotal = 1500) {
  console.log(`\n=== EXPANDIENDO CATÁLOGO TOP MAL A ${targetTotal} ANIMES CON TRADUCCIÓN ===`);
  await Storage.initDirectories();
  const mal = new MalClient();
  const rankingTypes = ["bypopularity", "all", "favorite"];
  const PAGE_LIMIT = 50;

  const animeIds = new Set();

  for (const ranking of rankingTypes) {
    console.log(`[CatalogExpander] Recolectando IDs de ranking: ${ranking}...`);
    for (let offset = 0; offset < 500; offset += PAGE_LIMIT) {
      try {
        const res = await mal.getAnimeRanking(ranking, PAGE_LIMIT, offset);
        if (!res?.data || res.data.length === 0) break;
        for (const item of res.data) {
          if (item?.node?.id) animeIds.add(item.node.id);
        }
        await sleep(200);
      } catch (err) {
        console.warn(`[CatalogExpander] Error en offset ${offset}: ${err.message}`);
        break;
      }
      if (animeIds.size >= targetTotal) break;
    }
    if (animeIds.size >= targetTotal) break;
  }

  console.log(`[CatalogExpander] Total IDs únicos recolectados para catálogo: ${animeIds.size}`);

  let count = 0;
  let newAdded = 0;
  const idList = Array.from(animeIds);

  for (const id of idList) {
    count++;
    try {
      const existing = await Storage.loadAnimeDetails(id);
      if (existing && existing.synopsis_es) {
        continue; // Ya está completo
      }

      let animeData = existing;
      if (!animeData) {
        const detailsRes = await mal.getAnimeDetails(id);
        if (detailsRes) {
          animeData = toAnimeSummary(detailsRes);
        }
        await sleep(150);
      }

      if (animeData) {
        if (animeData.synopsis && (!animeData.synopsis_es || animeData.synopsis_es.trim() === "")) {
          const trans = await translateGtx(animeData.synopsis);
          if (trans) {
            animeData.synopsis_es = trans;
          }
          await sleep(60);
        }

        animeData.translations_updated_at = new Date().toISOString();
        await Storage.saveAnimeDetails(id, animeData);
        newAdded++;
        if (newAdded % 10 === 0 || count % 25 === 0) {
          console.log(`[CatalogExpander] [${count}/${idList.length}] Añadido/Actualizado: ${animeData.title} (ID: ${id})`);
        }
      }
    } catch (err) {
      console.warn(`[CatalogExpander] Error procesando anime ${id}: ${err.message}`);
    }
  }

  console.log(`\n=== EXPANSIÓN COMPLETADA: ${newAdded} animes añadidos/actualizados al CDN ===\n`);
}

if (process.argv[1]?.endsWith("catalogExpander.js")) {
  expandTopCatalog(1500).catch(e => {
    console.error("Error fatal:", e);
    process.exit(1);
  });
}
