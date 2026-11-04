import { toDisplayMediaType } from "./constants.js";

/**
 * Mapea un nodo de MyAnimeList al modelo que espera la app Android TV (AnimeSummary)
 * y además conserva los campos nativos de MalAnime para compatibilidad 100% con ambos modelos.
 */
export function toAnimeSummary(node) {
  if (!node) return null;

  const pictures = Array.isArray(node.pictures) ? node.pictures : [];
  const backdrop =
    pictures[0]?.large ||
    pictures[0]?.medium ||
    node.main_picture?.large ||
    node.main_picture?.medium ||
    null;

  const pictureUrls = pictures
    .map((p) => p.large || p.medium)
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

  return {
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

    // Información básica
    synopsis: node.synopsis || null,
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

    // Imágenes para Compose
    images: {
      jpg: {
        imageUrl: node.main_picture?.medium || null,
        largeImageUrl: node.main_picture?.large || node.main_picture?.medium || null,
      },
    },
    main_picture: node.main_picture || null,

    // Backdrop / Trailer imágenes
    trailer: backdrop
      ? {
          images: {
            maximumImageUrl: backdrop,
            imageUrl: backdrop,
            smallImageUrl: backdrop,
            mediumImageUrl: backdrop,
            largeImageUrl: backdrop,
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

    // Campos detallados adicionales (DETAIL_FIELDS)
    rank: node.rank || null,
    popularity: node.popularity || null,
    num_scoring_users: node.num_scoring_users || null,
    nsfw: node.nsfw || null,
    created_at: node.created_at || null,
    updated_at: node.updated_at || null,
    source: node.source || null,
    rating: node.rating || null,
    background: node.background || null,
    related_anime: node.related_anime || [],
    related_manga: node.related_manga || [],
    recommendations: node.recommendations || [],
    statistics: node.statistics || null,
  };
}
