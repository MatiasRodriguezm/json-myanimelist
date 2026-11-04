# AnimeHub - MyAnimeList JSON Cache Service

Servicio microservicio en Node.js que recolecta, cachea y sirve las listas y metadata de MyAnimeList para la aplicación **AnimeHub (Android TV)**, eliminando las consultas directas de los usuarios a MAL para garantizar cargas instantáneas en 0 ms y evitar saturación o bloqueos del API.

## Características

- ⚡ **Carga instantánea**: Entrega las listas completas de Inicio y Descubrir en milisegundos desde JSON / memoria.
- ⏰ **Actualización automática cada 6 horas**: Programada mediante `node-cron` (`0 */6 * * *`) respetando las cuotas de MyAnimeList.
- 🛡️ **Cero saturación a MAL**: No importa cuántos usuarios usen la app, MyAnimeList solo recibe 1 petición periódica desde este servidor.
- 🔄 **Caché en Lectura (Read-Through Cache)**: Si un usuario abre un anime antiguo que no estaba en las listas de temporada, el servidor lo busca en MAL en tiempo real, lo guarda en `data/anime/{id}.json` y lo entrega. Las siguientes consultas son instantáneas.
- 📦 **Compresión Gzip**: Respuestas ultralivianas para dispositivos con red lenta o WiFi débil.
- 🎯 **100% Compatible con AnimeHub**: Mapeo exacto con los modelos `AnimeSummary` y `MalAnime` de la aplicación Android.

---

## Estructura del Proyecto

```text
D:\Proyectos 2025\json-myanimelist\
├── package.json
├── .env
├── index.js                     # Punto de entrada principal
├── src/
│   ├── config.js                # Variables de entorno y configuración
│   ├── constants.js             # LIST_FIELDS, DETAIL_FIELDS y temporadas
│   ├── malClient.js             # Cliente MAL con control de velocidad y reintentos
│   ├── mapper.js                # Mapeador idéntico a AnimeRepository.kt
│   ├── storage.js               # Lectura/escritura atómica en JSON y caché RAM
│   ├── collector.js             # Recolector de temporadas, rankings y metadata
│   ├── scheduler.js             # Cron job cada 6 horas
│   └── server.js                # Servidor Express con compresión y endpoints
└── data/                        # Almacén de archivos JSON (se crea automáticamente)
    ├── home.json                # Listas de Inicio (Temporada actual, Próxima, Top)
    ├── discover.json            # Las 8 categorías de Descubrir
    ├── status.json              # Estado de la última sincronización
    └── anime/                   # Metadata individual de cada anime
        ├── 1.json
        ├── 21.json
        └── ...
```

---

## Instalación y Uso

### 1. Instalar dependencias
```bash
npm install
```

### 2. Iniciar el servidor
```bash
npm start
```
*Si es la primera vez que arranca y no hay datos, iniciará automáticamente una sincronización con MyAnimeList en segundo plano.*

### 3. Modo desarrollo (recarga automática ante cambios)
```bash
npm run dev
```

### 4. Forzar sincronización manual desde consola
```bash
npm run sync
```

---

## Endpoints de la API

| Método | Ruta | Descripción |
| :--- | :--- | :--- |
| `GET` | `/` | Información del servicio, estado y enlaces rápidos. |
| `GET` | `/api/health` | Estado del servicio y cantidad de animes cacheados. |
| `GET` | `/api/home` | **HomeFeed**: Top anime, Temporada actual, Próxima temporada. |
| `GET` | `/api/discover` | **Descubrir**: Las 8 filas completas con sus animes. |
| `GET` | `/api/discover/:sectionId` | Obtiene una sección específica (ej: `/api/discover/bypopularity`). |
| `GET` | `/api/anime/:id` | **Metadata**: Detalle del anime (lee del disco o busca en MAL y guarda). |
| `POST` | `/api/sync` | Dispara una sincronización manual en segundo plano. |
| `GET` | `/data/home.json` | Acceso estático directo al archivo JSON crudo. |

---

## Integración con AnimeHub (Android TV)

En el proyecto Android, en lugar de consultar MyAnimeList para el catálogo público, se apunta a este servicio:

```kotlin
interface CatalogApi {
    @GET("api/home")
    suspend fun getHomeFeed(): HomeFeed

    @GET("api/discover")
    suspend fun getDiscover(): DiscoverData

    @GET("api/anime/{id}")
    suspend fun getAnimeDetails(@Path("id") id: Int): AnimeSummary
}
```
*La autenticación de usuario y listas privadas ("Mi Lista") se mantienen independientes vía OAuth directo.*
