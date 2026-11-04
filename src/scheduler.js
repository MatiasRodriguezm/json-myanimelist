import cron from "node-cron";
import { config } from "./config.js";
import { Collector } from "./collector.js";

export class Scheduler {
  constructor(collector = new Collector()) {
    this.collector = collector;
    this.task = null;
  }

  start() {
    console.log(`[Scheduler] Programando actualización automática cada 6 horas: "${config.cronSchedule}"`);
    this.task = cron.schedule(config.cronSchedule, async () => {
      console.log(`[Scheduler] ⏰ Cron activado (ciclo de 6 horas). Ejecutando recolector...`);
      try {
        await this.collector.run();
      } catch (err) {
        console.error(`[Scheduler] Falló la ejecución programada:`, err);
      }
    });
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log("[Scheduler] Programador detenido.");
    }
  }
}
