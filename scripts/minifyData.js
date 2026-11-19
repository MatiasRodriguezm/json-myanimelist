import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config.js";

async function getJsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const res = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getJsonFiles(res)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(res);
    }
  }
  return files;
}

async function minifyAll() {
  console.log("=== INICIANDO MINIFICACIÓN DE ARCHIVOS JSON EN DATA/ ===");
  const targetDir = config.paths.data;
  const files = await getJsonFiles(targetDir);
  console.log(`Encontrados ${files.length} archivos JSON para procesar...`);

  let totalBefore = 0;
  let totalAfter = 0;
  let optimizedCount = 0;

  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf-8");
      const beforeBytes = Buffer.byteLength(content, "utf-8");
      totalBefore += beforeBytes;

      const parsed = JSON.parse(content);
      const minified = JSON.stringify(parsed);
      const afterBytes = Buffer.byteLength(minified, "utf-8");

      if (afterBytes < beforeBytes) {
        await fs.writeFile(file, minified, "utf-8");
        totalAfter += afterBytes;
        optimizedCount++;
      } else {
        totalAfter += beforeBytes;
      }
    } catch (err) {
      console.warn(`[Aviso] No se pudo minificar ${path.basename(file)}: ${err.message}`);
    }
  }

  const savedBytes = totalBefore - totalAfter;
  const savedMb = (savedBytes / (1024 * 1024)).toFixed(2);
  const percent = totalBefore > 0 ? ((savedBytes / totalBefore) * 100).toFixed(1) : 0;

  console.log("--------------------------------------------------");
  console.log(`✓ Archivos optimizados: ${optimizedCount} / ${files.length}`);
  console.log(`✓ Tamaño original:     ${(totalBefore / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`✓ Tamaño final:        ${(totalAfter / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`✓ Espacio ahorrado:    ${savedMb} MB (-${percent}%)`);
  console.log("==================================================");
}

minifyAll().catch((err) => {
  console.error("Error en minificación:", err);
  process.exit(1);
});
