// Campos exactos utilizados por AnimeRepository.kt en AnimeHub
export const LIST_FIELDS =
  "id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,rating,num_list_users,media_type,status,genres,num_episodes,start_season,broadcast,average_episode_duration,pictures,studios";

export const DETAIL_FIELDS =
  "id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,num_list_users,num_scoring_users,nsfw,created_at,updated_at,media_type,status,genres,num_episodes,start_season,broadcast,source,average_episode_duration,rating,pictures,background,related_anime,related_manga,recommendations,studios,statistics";

export const DISCOVER_SECTIONS = [
  { sectionId: "bypopularity", rankingType: "bypopularity", title: "Mas populares" },
  { sectionId: "upcoming", rankingType: "upcoming", title: "Proximamente" },
  { sectionId: "all", rankingType: "all", title: "Ranking general" },
  { sectionId: "tv", rankingType: "tv", title: "Series TV" },
  { sectionId: "movie", rankingType: "movie", title: "Peliculas" },
  { sectionId: "ova", rankingType: "ova", title: "OVAs" },
  { sectionId: "ona", rankingType: "ona", title: "ONAs", isOnaFilter: true },
  { sectionId: "special", rankingType: "special", title: "Especiales" },
];

export function getSeasonForDate(date = new Date()) {
  const month = date.getMonth() + 1; // 1 - 12
  const year = date.getFullYear();
  let season = "fall";
  if (month >= 1 && month <= 3) season = "winter";
  else if (month >= 4 && month <= 6) season = "spring";
  else if (month >= 7 && month <= 9) season = "summer";
  return { year, season };
}

export function getNextSeason({ year, season }) {
  switch (season.toLowerCase()) {
    case "winter": return { year, season: "spring" };
    case "spring": return { year, season: "summer" };
    case "summer": return { year, season: "fall" };
    default: return { year: year + 1, season: "winter" };
  }
}

export function toSpanishSeason(season) {
  switch (season?.toLowerCase()) {
    case "winter": return "Invierno";
    case "spring": return "Primavera";
    case "summer": return "Verano";
    case "fall":
    case "autumn": return "Otoño";
    default: return season ? season.charAt(0).toUpperCase() + season.slice(1) : "";
  }
}

export function toDisplayMediaType(mediaType) {
  if (!mediaType) return null;
  const lower = mediaType.toLowerCase();
  switch (lower) {
    case "tv": return "TV";
    case "movie": return "Movie";
    case "ova": return "OVA";
    case "ona": return "ONA";
    case "special": return "Special";
    case "music": return "Music";
    default: return mediaType.charAt(0).toUpperCase() + mediaType.slice(1);
  }
}
