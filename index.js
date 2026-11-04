import { config } from "./src/config.js";
import { Collector } from "./src/collector.js";
import { MalClient } from "./src/malClient.js";
import { Scheduler } from "./src/scheduler.js";
import { createExpressApp } from "./src/server.js";
import { Storage } from "./src/storage.js";

async function main() {
  console.log("==================================================");
  console.log("  Iniciando AnimeHub MAL JSON Cache Service");
  console.log("==================================================");

  // Asegurar que existan las carpetas de datos
  await Storage.initDirectories();

  const malClient = new MalClient(config.malClientId);
  const collector = new Collector(malClient);
  const scheduler = new Scheduler(collector);

  const app = createExpressApp(collector, malClient);

  const server = app.listen(config.port, () => {
    console.log(`[HTTP Server] Escuchando en http://localhost:${config.port}`);
    console.log(`  - Inicio:        http://localhost:${config.port}/api/home`);
    console.log(`  - Descubrir:     http://localhost:${config.port}/api/discover`);
    console.log(`  - Metadata:      http://localhost:${config.port}/api/anime/1`);
    console.log(`  - Estado/Salud:  http://localhost:${config.port}/api/health`);
  });

  // Iniciar el programador de tareas (cada 6 horas)
  scheduler.start();

  // Si no existen los archivos JSON de inicio y está configurado, ejecutar recolección inicial
  const stats = await Storage.getStats();
  if ((!stats.hasHomeFeed || !stats.hasDiscover) && config.syncOnStartup) {
    console.log("\n[Startup] No se encontraron archivos de catálogo previos. Iniciando recolección inicial...");
    collector.run().catch((err) => {
      console.error("[Startup] Error en recolección inicial:", err);
    });
  } else {
    console.log(`\n[Startup] Catálogos encontrados en disco: ${stats.cachedAnimeCount} animes en caché.`);
  }

  // Cierre limpio ante interrupciones
  function shutdown(signal) {
    console.log(`\n[Shutdown] Recibida señal ${signal}. Cerrando servidor...`);
    scheduler.stop();
    server.close(() => {
      console.log("[Shutdown] Servidor detenido correctamente.");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Error fatal al iniciar el servicio:", err);
  process.exit(1);
});
