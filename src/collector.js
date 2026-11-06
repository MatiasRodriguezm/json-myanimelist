import { config } from "./config.js";
import {
  DISCOVER_SECTIONS,
  getNextSeason,
  getSeasonForDate,
  toSpanishSeason,
} from "./constants.js";
import { MalClient } from "./malClient.js";
import { toAnimeSummary } from "./mapper.js";
import { Storage } from "./storage.js";
import { syncLiveChart } from "./livechartScraper.js";
import { SimklClient } from "./simklClient.js";

export class Collector {
  constructor(malClient = new MalClient(), simklClient = new SimklClient()) {
    this.mal = malClient;
    this.simkl = simklClient;
    this.isRunning = false;
  }

  async run() {
    if (this.isRunning) {
      console.warn("[Collector] Ya hay una sincronización en curso. Se omite esta ejecución.");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    console.log(`\n==================================================`);
    console.log(`[Collector] Iniciando sincronización de Catálogos (MAL + LiveChart + Simkl): ${new Date().toISOString()}`);
    console.log(`==================================================`);

    try {
      await Storage.initDirectories();

      // 1. Calcular temporadas
      const currentSeason = getSeasonForDate();
      const nextSeason = getNextSeason(currentSeason);
      console.log(`[Collector] Temporada actual: ${currentSeason.season} ${currentSeason.year}`);
      console.log(`[Collector] Próxima temporada: ${nextSeason.season} ${nextSeason.year}`);

      // 2. Recolectar Inicio (HomeFeed)
      console.log(`[Collector] Descargando datos de Inicio (Top Ranking, Temporada actual y Próxima)...`);
      const [topRankingRes, currentSeasonRes, nextSeasonRes] = await Promise.all([
        this.mal.getAnimeRanking("all", config.collector.homeRankingLimit),
        this.mal.getSeasonalAnime(currentSeason.year, currentSeason.season, config.collector.seasonLimit),
        this.mal.getSeasonalAnime(nextSeason.year, nextSeason.season, 100),
      ]);

      const topAnime = (topRankingRes.data || []).map((item) => toAnimeSummary(item.node));

      // Ordenar temporada actual por score desc, usuarios desc
      const seasonalAnime = (currentSeasonRes.data || [])
        .map((item) => toAnimeSummary(item.node))
        .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.numListUsers || 0) - (a.numListUsers || 0));

      // Ordenar próxima temporada por popularidad/usuarios desc
      const upcomingAnime = (nextSeasonRes.data || [])
        .map((item) => toAnimeSummary(item.node))
        .sort((a, b) => (b.numListUsers || 0) - (a.numListUsers || 0) || (b.score || 0) - (a.score || 0));

      const homeFeed = {
        featured: topAnime[0] || null,
        topAnime,
        seasonalAnime,
        upcomingAnime,
        currentSeasonTitle: `Temporada actual ${toSpanishSeason(currentSeason.season)} ${currentSeason.year}`,
        upcomingSeasonTitle: `Próxima Temporada ${toSpanishSeason(nextSeason.season)} ${nextSeason.year}`,
        updatedAt: new Date().toISOString(),
      };

      await Storage.saveHomeFeed(homeFeed);
      console.log(`[Collector] ✓ home.json guardado con éxito (${topAnime.length} top, ${seasonalAnime.length} temporada actual, ${upcomingAnime.length} próximos).`);

      // 3. Recolectar Pestaña Descubrir
      console.log(`[Collector] Descargando secciones de Descubrir...`);
      const discoverRows = [];

      for (const section of DISCOVER_SECTIONS) {
        console.log(`  -> Obteniendo sección: ${section.title} (${section.sectionId})...`);
        let items = [];

        if (section.isOnaFilter) {
          // Filtrado especial para ONAs: consultar ranking 'all' y filtrar media_type 'ona'
          const onaScanRes = await this.mal.getAnimeRanking("all", 100, 0);
          items = (onaScanRes.data || [])
            .map((item) => toAnimeSummary(item.node))
            .filter((anime) => anime.media_type === "ona" || anime.type === "ONA");
        } else {
          const sectionRes = await this.mal.getAnimeRanking(
            section.rankingType,
            config.collector.discoverSectionLimit
          );
          items = (sectionRes.data || []).map((item) => toAnimeSummary(item.node));
        }

        discoverRows.push({
          sectionId: section.sectionId,
          rankingType: section.rankingType,
          title: section.title,
          items,
          totalCount: items.length,
        });
      }

      const discoverData = {
        rows: discoverRows,
        updatedAt: new Date().toISOString(),
      };

      await Storage.saveDiscover(discoverData);
      console.log(`[Collector] ✓ discover.json guardado con éxito (${discoverRows.length} secciones).`);

      // 4. Pre-guardar metadata de todos los animes de las listas y enriquecer con Simkl
      console.log(`[Collector] Inicializando base de equivalencias e información de Simkl...`);
      await this.simkl.init();

      console.log(`[Collector] Verificando metadata individual y enriqueciendo con Simkl...`);
      const uniqueAnimeMap = new Map();

      // Recopilar animes de Home
      for (const anime of [...topAnime, ...seasonalAnime, ...upcomingAnime]) {
        if (anime && anime.id) uniqueAnimeMap.set(anime.id, anime);
      }

      // Recopilar animes de Descubrir
      for (const row of discoverRows) {
        for (const anime of row.items) {
          if (anime && anime.id) uniqueAnimeMap.set(anime.id, anime);
        }
      }

      let savedDetailsCount = 0;
      let simklEnrichedCount = 0;
      let simklReusedCount = 0;

      for (const [id, summary] of uniqueAnimeMap) {
        let animeData = { ...summary };
        const existing = await Storage.loadAnimeDetails(id);
        const isFinished = (animeData.status || "").toLowerCase().includes("finish");

        // Optimización: si ya existe en disco, está finalizado y ya tiene episodios, reutilizar
        if (existing && isFinished && Array.isArray(existing.episodes_data) && existing.episodes_data.length > 0) {
          animeData.simkl_id = existing.simkl_id || null;
          animeData.episodes_data = existing.episodes_data;
          animeData.specials_data = existing.specials_data || [];
          simklReusedCount++;
        } else {
          // Obtener episodios y especiales de Simkl
          try {
            const simklId = await this.simkl.resolveSimklId(id);
            if (simklId) {
              animeData.simkl_id = simklId;
              const { episodes, specials } = await this.simkl.fetchEpisodes(simklId);
              animeData.episodes_data = episodes;
              animeData.specials_data = specials;
              if (episodes.length > 0 || specials.length > 0) {
                simklEnrichedCount++;
              }
            } else {
              animeData.simkl_id = existing?.simkl_id || null;
              animeData.episodes_data = existing?.episodes_data || [];
              animeData.specials_data = existing?.specials_data || [];
            }
          } catch (err) {
            console.warn(`[Collector] No se pudieron sincronizar episodios Simkl para anime ${id}:`, err.message);
            animeData.simkl_id = existing?.simkl_id || null;
            animeData.episodes_data = existing?.episodes_data || [];
            animeData.specials_data = existing?.specials_data || [];
          }
        }

        await Storage.saveAnimeDetails(id, animeData);
        savedDetailsCount++;
      }

      console.log(`[Collector] ✓ Metadata: ${savedDetailsCount} animes guardados (${simklEnrichedCount} enriquecidos frescos con Simkl, ${simklReusedCount} reutilizados de caché).`);

      // 5. Sincronizar días anteriores de LiveChart (Aislado con try/catch)
      try {
        await syncLiveChart();
      } catch (lcError) {
        console.warn("[Collector] Advertencia: Falló recolección de LiveChart, conservando datos previos:", lcError.message);
      }

      const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const statusData = {
        status: "success",
        lastSync: new Date().toISOString(),
        durationSeconds: Number(durationSeconds),
        uniqueAnimesInCatalog: uniqueAnimeMap.size,
        totalCachedAnimeFiles: (await Storage.getStats()).cachedAnimeCount,
        simklEnrichedCount,
        simklReusedCount,
      };
      await Storage.saveStatus(statusData);

      console.log(`==================================================`);
      console.log(`[Collector] Sincronización completada en ${durationSeconds} segundos.`);
      console.log(`==================================================\n`);
    } catch (error) {
      console.error("[Collector] Error crítico durante la sincronización:", error);
      await Storage.saveStatus({
        status: "error",
        lastSync: new Date().toISOString(),
        errorMessage: error.message,
      });
    } finally {
      this.isRunning = false;
    }
  }
}

// Ejecución directa desde consola: `node src/collector.js` o `npm run sync`
if (process.argv[1]?.endsWith("collector.js")) {
  const collector = new Collector();
  collector.run().then(() => process.exit(0));
}
