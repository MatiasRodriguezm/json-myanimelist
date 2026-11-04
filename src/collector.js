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

export class Collector {
  constructor(malClient = new MalClient()) {
    this.mal = malClient;
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
    console.log(`[Collector] Iniciando sincronización de MyAnimeList: ${new Date().toISOString()}`);
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

      // 4. Pre-guardar metadata de todos los animes de las listas
      console.log(`[Collector] Verificando metadata individual de animes recolectados...`);
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
      let alreadyCachedCount = 0;

      for (const [id, summary] of uniqueAnimeMap) {
        if (Storage.hasAnimeDetails(id)) {
          alreadyCachedCount++;
        } else {
          // Si no tiene el archivo individual, guardar de inmediato con la metadata disponible en la lista
          await Storage.saveAnimeDetails(id, summary);
          savedDetailsCount++;
        }
      }

      console.log(`[Collector] ✓ Metadata: ${alreadyCachedCount} ya existían, ${savedDetailsCount} guardados en data/anime/`);

      const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const statusData = {
        status: "success",
        lastSync: new Date().toISOString(),
        durationSeconds: Number(durationSeconds),
        uniqueAnimesInCatalog: uniqueAnimeMap.size,
        totalCachedAnimeFiles: (await Storage.getStats()).cachedAnimeCount,
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
