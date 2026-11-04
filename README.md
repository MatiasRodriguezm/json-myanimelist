# AnimeHub - MyAnimeList JSON CDN & Cache Service

Distribución global mediante **GitHub Actions + GitHub Pages (CDN Fastly)** de catálogos y metadata de MyAnimeList para la aplicación **AnimeHub (Android TV)**.

Garantiza **cargas instantáneas en 0 ms**, **cero saturación a la API de MAL**, **cero arranques en frío** y **$0 de costo de mantenimiento**.

---

## URLs Públicas del CDN (GitHub Pages)

Una vez habilitado GitHub Pages en el repositorio, tus endpoints globales con HTTPS y respuesta en ~15 ms son:

* 🏠 **Inicio (HomeFeed)**:  
  `https://matiasrodriguezm.github.io/json-myanimelist/home.json`
* 🔍 **Pestaña Descubrir**:  
  `https://matiasrodriguezm.github.io/json-myanimelist/discover.json`
* 📄 **Metadata de Anime (ejemplo Frieren ID 52991)**:  
  `https://matiasrodriguezm.github.io/json-myanimelist/anime/52991.json`
* 📊 **Estado de Sincronización**:  
  `https://matiasrodriguezm.github.io/json-myanimelist/status.json`

*(También accesibles vía el CDN de jsDelivr con respaldo global de Cloudflare:)*
* `https://cdn.jsdelivr.net/gh/MatiasRodriguezm/json-myanimelist@main/data/home.json`
* `https://cdn.jsdelivr.net/gh/MatiasRodriguezm/json-myanimelist@main/data/discover.json`

---

## Cómo Funciona la Automatización

1. **Cada 6 horas en punto (`0 */6 * * *`)**:
   * GitHub Actions se despierta automáticamente.
   * Ejecuta `npm run sync`.
   * Realiza las consultas con control de tasa a MyAnimeList (`MAL_CLIENT_ID`).
   * Actualiza las listas de Inicio (Temporada actual, próxima y top) y Descubrir (las 8 categorías).
   * Pre-guarda la metadata de los animes nuevos.
2. **Auto-commit & Despliegue**:
   * Guarda los cambios en la rama `main` del repositorio (`git commit [skip ci]`).
   * Despliega la carpeta `data/` al CDN de **GitHub Pages**.

---

## Cómo Activar GitHub Pages en tu Repositorio

1. Entra a tu repositorio: [https://github.com/MatiasRodriguezm/json-myanimelist](https://github.com/MatiasRodriguezm/json-myanimelist)
2. Ve a **Settings** > **Pages** (en el menú lateral izquierdo).
3. En **Build and deployment** > **Source**, selecciona:  
   👉 **GitHub Actions**.
4. ¡Listo! Cada vez que el cron de 6 horas se ejecute (o cuando hagas clic en **Run workflow** en la pestaña Actions), se desplegará solo.

---

## Ejecución Local (Opcional)

Si deseas correrlo o probarlo en tu máquina:

```bash
# Instalar dependencias
npm install

# Forzar sincronización manual
npm run sync

# Iniciar servidor local en http://localhost:4000
npm start
```
