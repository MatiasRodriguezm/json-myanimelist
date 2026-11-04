import compression from "compression";
import cors from "cors";
import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { MalClient } from "./malClient.js";
import { toAnimeSummary } from "./mapper.js";
import { Storage } from "./storage.js";

export function createExpressApp(collector = null, malClient = new MalClient()) {
  const app = express();

  app.use(cors());
  app.use(compression());
  app.use(express.json());

  // Servir archivos JSON directamente si se requiere acceso estático crudo
  app.use("/data", express.static(config.paths.data));

  // Índice de estado del servicio
  app.get("/", async (req, res) => {
    const stats = await Storage.getStats();
    res.json({
      service: "AnimeHub MyAnimeList JSON Cache Service",
      version: "1.0.0",
      status: "running",
      port: config.port,
      stats,
      endpoints: {
        home: "/api/home",
        discover: "/api/discover",
        animeDetails: "/api/anime/:id",
        health: "/api/health",
        manualSync: "POST /api/sync",
      },
    });
  });

  // Healthcheck y estadísticas
  app.get("/api/health", async (req, res) => {
    const stats = await Storage.getStats();
    res.json({ status: "ok", ...stats });
  });

  // 1. Endpoint Inicio (HomeFeed)
  app.get("/api/home", async (req, res) => {
    try {
      const data = await Storage.loadHomeFeed();
      if (!data) {
        return res.status(503).json({
          error: "CATALOG_NOT_READY",
          message: "El catálogo de inicio se está inicializando. Intente en unos segundos.",
        });
      }
      res.setHeader("Cache-Control", "public, max-age=300"); // 5 minutos en cliente
      return res.json(data);
    } catch (err) {
      console.error("[API] Error en /api/home:", err);
      return res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
    }
  });

  // 2. Endpoint Descubrir
  app.get("/api/discover", async (req, res) => {
    try {
      const data = await Storage.loadDiscover();
      if (!data) {
        return res.status(503).json({
          error: "CATALOG_NOT_READY",
          message: "El catálogo de descubrir se está inicializando. Intente en unos segundos.",
        });
      }
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.json(data);
    } catch (err) {
      console.error("[API] Error en /api/discover:", err);
      return res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
    }
  });

  // 2b. Endpoint para una sección puntual de descubrir
  app.get("/api/discover/:sectionId", async (req, res) => {
    try {
      const { sectionId } = req.params;
      const data = await Storage.loadDiscover();
      if (!data || !Array.isArray(data.rows)) {
        return res.status(503).json({ error: "CATALOG_NOT_READY" });
      }

      const row = data.rows.find(
        (r) => r.sectionId?.toLowerCase() === sectionId.toLowerCase()
      );

      if (!row) {
        return res.status(404).json({ error: "SECTION_NOT_FOUND", sectionId });
      }

      res.setHeader("Cache-Control", "public, max-age=300");
      return res.json(row);
    } catch (err) {
      return res.status(500).json({ error: "INTERNAL_ERROR", message: err.message });
    }
  });

  // 3. Endpoint de Metadata con Caché en Lectura (Read-Through Cache)
  app.get("/api/anime/:id", async (req, res) => {
    const animeId = Number(req.params.id);
    if (!animeId || Number.isNaN(animeId) || animeId <= 0) {
      return res.status(400).json({ error: "INVALID_ID", message: "ID de anime inválido." });
    }

    try {
      // Paso 1: Verificar si ya existe en el disco / memoria
      const cached = await Storage.loadAnimeDetails(animeId);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Cache-Control", "public, max-age=86400"); // 24 horas
        return res.json(cached);
      }

      // Paso 2: Si NO existe, consultarlo a MAL en tiempo real
      console.log(`[API] Anime ID ${animeId} no estaba en caché. Consultando a MyAnimeList...`);
      res.setHeader("X-Cache", "MISS");

      const malRaw = await malClient.getAnimeDetails(animeId);
      if (!malRaw || !malRaw.id) {
        return res.status(404).json({ error: "NOT_FOUND", message: `Anime ${animeId} no encontrado en MAL.` });
      }

      // Paso 3: Mapear y guardar en disco de inmediato
      const mapped = toAnimeSummary(malRaw);
      await Storage.saveAnimeDetails(animeId, mapped);
      console.log(`[API] ✓ Anime ID ${animeId} (${mapped.title}) guardado permanentemente en data/anime/${animeId}.json`);

      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.json(mapped);
    } catch (err) {
      console.error(`[API] Error al resolver anime ID ${animeId}:`, err.message);
      if (err.message.includes("404")) {
        return res.status(404).json({ error: "NOT_FOUND", message: `El anime ${animeId} no existe en MAL.` });
      }
      return res.status(502).json({
        error: "MAL_UPSTREAM_ERROR",
        message: `No se pudo obtener el anime ${animeId} desde MyAnimeList: ${err.message}`,
      });
    }
  });

  // 4. Endpoint para forzar sincronización manual
  app.post("/api/sync", async (req, res) => {
    if (config.syncApiKey) {
      const apiKey = req.headers["x-api-key"] || req.query.apiKey;
      if (apiKey !== config.syncApiKey) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
    }

    if (!collector) {
      return res.status(500).json({ error: "COLLECTOR_NOT_ATTACHED" });
    }

    if (collector.isRunning) {
      return res.status(409).json({ status: "busy", message: "La sincronización ya está en progreso." });
    }

    // Iniciar en segundo plano
    collector.run().catch((e) => console.error("[Manual Sync] Falló:", e));
    return res.json({ status: "accepted", message: "Sincronización manual iniciada en segundo plano." });
  });

  return app;
}
