import { toDisplayMediaType } from "./constants.js";

/**
 * Convierte URLs de imágenes de cdn.myanimelist.net a formato WebP.
 * WebP en el CDN de MAL reduce el peso de transferencia en un ~72% con la misma resolución.
 */
export function toWebpUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (url.includes("cdn.myanimelist.net")) {
    return url.replace(/\.(jpg|jpeg|png)$/i, ".webp");
  }
  return url;
}

/**
 * Mapea un nodo de MyAnimeList al modelo que espera la app Android TV (AnimeSummary).
 * Si isFeed = true, omite listas profundas vacías para mantener home.json y discover.json ultra livianos.
 */
export function toAnimeSummary(node, isFeed = false) {
  if (!node) return null;

  const pictures = Array.isArray(node.pictures) ? node.pictures : [];
  const rawBackdrop =
    pictures[0]?.large ||
    pictures[0]?.medium ||
    node.main_picture?.large ||
    node.main_picture?.medium ||
    null;
  const backdrop = toWebpUrl(rawBackdrop);

  const pictureUrls = pictures
    .map((p) => toWebpUrl(p.large || p.medium))
    .filter(Boolean);

  const startSeason = node.start_season || null;
  const startYear =
    startSeason?.year ||
    (node.start_date ? Number.parseInt(node.start_date.slice(0, 4), 10) : null) ||
    null;

  const genres = Array.isArray(node.genres)
    ? node.genres.map((g) => ({ id: g.id, name: g.name }))
    : [];

  const studios = Array.isArray(node.studios)
    ? node.studios.map((s) => ({ id: s.id, name: s.name }))
    : [];

  const broadcastDay = node.broadcast?.day_of_the_week || null;
  const broadcastTime = node.broadcast?.start_time || null;
  const broadcastString = [broadcastDay, broadcastTime].filter(Boolean).join(" ");

  const mediumPicture = toWebpUrl(node.main_picture?.medium) || null;
  const largePicture = toWebpUrl(node.main_picture?.large) || mediumPicture;

  const baseSummary = {
    // Identificadores (compatible con id y mal_id)
    id: node.id,
    mal_id: node.id,

    // Títulos
    title: node.title,
    englishTitle: node.alternative_titles?.en || null,
    title_english: node.alternative_titles?.en || null,
    alternative_titles: node.alternative_titles || {
      synonyms: [],
      en: null,
      ja: null,
    },

    // Información básica y sinopsis (esencial para el Header superior de la app)
    synopsis: node.synopsis || null,
    synopsis_es: node.synopsis_es || null,
    type: toDisplayMediaType(node.media_type),
    media_type: node.media_type || null,
    status: node.status || null,
    averageEpisodeDurationSeconds: node.average_episode_duration || null,
    average_episode_duration: node.average_episode_duration || null,
    startDate: node.start_date || null,
    start_date: node.start_date || null,
    endDate: node.end_date || null,
    end_date: node.end_date || null,
    season: startSeason?.season || null,
    year: startYear,
    start_season: startSeason,
    episodes: node.num_episodes || null,
    num_episodes: node.num_episodes || null,
    score: node.mean != null ? Number(node.mean) : null,
    mean: node.mean != null ? Number(node.mean) : null,
    numListUsers: node.num_list_users || null,
    num_list_users: node.num_list_users || null,

    // Colecciones estructuradas
    genres,
    studios,
    pictures: pictureUrls,

    // Assets de TheMovieDB (TMDb)
    backdrop_url: node.backdrop_url || null,
    logo_url: node.logo_url || null,
    tmdb_id: node.tmdb_id || null,
    tmdb_updated_at: node.tmdb_updated_at || null,

    // Imágenes para Compose en WebP optimizado
    images: {
      jpg: {
        image_url: mediumPicture,
        large_image_url: largePicture,
      },
    },
    main_picture: node.main_picture
      ? {
          medium: mediumPicture,
          large: largePicture,
        }
      : null,

    // Backdrop / Trailer compacto (TrailerImages solo consume maximum_image_url)
    trailer: backdrop
      ? {
          images: {
            maximum_image_url: backdrop,
          },
        }
      : null,

    // Horarios de emisión
    broadcast: broadcastDay || broadcastTime
      ? {
          day: broadcastDay,
          time: broadcastTime,
          day_of_the_week: broadcastDay,
          start_time: broadcastTime,
          timezone: "Asia/Tokyo",
          string: broadcastString || null,
        }
      : null,

    rank: node.rank || null,
    popularity: node.popularity || null,
    rating: node.rating || null,
  };

  // Si es un resumen para Home o Discover, omitir listas de detalle que van vacías
  if (isFeed) {
    return baseSummary;
  }

  // Ficha completa de detalle individual (data/anime/{id}.json)
  return {
    ...baseSummary,
    simkl_id: node.simkl_id || null,
    episodes_data: node.episodes_data || [],
    specials_data: node.specials_data || [],
    characters: node.characters || [],
    num_scoring_users: node.num_scoring_users || null,
    nsfw: node.nsfw || null,
    created_at: node.created_at || null,
    updated_at: node.updated_at || null,
    source: node.source || null,
    background: node.background || null,
    related_anime: node.related_anime || [],
    related_manga: node.related_manga || [],
    recommendations: node.recommendations || [],
    statistics: node.statistics || null,
  };
}

/**
 * Convierte un item devuelto por animejikanapi al formato AnimeSummary compatible con AnimeHub.
 */
export function jikanToAnimeSummary(item) {
  if (!item) return null;
  const id = item.malId || item.id;
  const webpLarge = item.images?.webp?.largeImageUrl || item.images?.webp?.imageUrl;
  const jpgLarge = item.images?.jpg?.largeImageUrl || item.images?.jpg?.imageUrl;
  const webpMedium = item.images?.webp?.imageUrl || item.images?.webp?.smallImageUrl;
  const jpgMedium = item.images?.jpg?.imageUrl || item.images?.jpg?.smallImageUrl;

  const largeImg = toWebpUrl(webpLarge || jpgLarge || "");
  const mediumImg = toWebpUrl(webpMedium || jpgMedium || largeImg);

  const year = item.startDate ? Number.parseInt(item.startDate.slice(0, 4), 10) : null;
  const startDateStr = item.startDate ? item.startDate.split("T")[0] : null;
  const endDateStr = item.endDate ? item.endDate.split("T")[0] : null;

  return {
    id: Number(id),
    mal_id: Number(id),
    title: item.title,
    englishTitle: item.title_english || item.englishTitle || null,
    title_english: item.title_english || item.englishTitle || null,
    alternative_titles: {
      synonyms: [],
      en: item.title_english || item.englishTitle || null,
      ja: null,
    },
    synopsis: item.synopsis || null,
    synopsis_es: null,
    type: toDisplayMediaType(item.type) || "TV",
    media_type: (item.type || "tv").toLowerCase(),
    status: item.airing ? "currently_airing" : (item.status || null),
    startDate: startDateStr,
    start_date: startDateStr,
    endDate: endDateStr,
    end_date: endDateStr,
    year: year,
    episodes: item.episodes || null,
    num_episodes: item.episodes || null,
    score: item.score || null,
    mean: item.score || null,
    numListUsers: item.members || 0,
    num_list_users: item.members || 0,
    genres: (item.genres || []).map((g) => ({ id: g.id || g.mal_id, name: g.name })),
    images: {
      jpg: {
        image_url: jpgMedium,
        large_image_url: jpgLarge,
      },
      webp: {
        image_url: webpMedium,
        large_image_url: webpLarge,
      },
    },
    main_picture: {
      medium: mediumImg,
      large: largeImg,
    },
    pictures: [],
    rating: item.rated || item.rating || null,
  };
}
