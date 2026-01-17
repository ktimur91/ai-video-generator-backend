const axios = require("axios");

// Jamendo API - бесплатный API для royalty-free музыки
// Документация: https://developer.jamendo.com/v3.0/tracks
// Нужно зарегистрироваться на https://devportal.jamendo.com/ для получения client_id

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || "your_client_id";

const jamendoClient = axios.create({
  baseURL: "https://api.jamendo.com/v3.0",
  params: {
    client_id: JAMENDO_CLIENT_ID,
    format: "json",
  },
});

// Жанры доступные в Jamendo
const MUSIC_GENRES = [
  "electronic",
  "rock",
  "pop",
  "hiphop",
  "jazz",
  "classical",
  "ambient",
  "metal",
  "folk",
  "world",
  "reggae",
  "blues",
  "country",
  "rnb",
  "latin",
  "funk",
  "soul",
  "soundtrack",
  "lounge",
  "relaxation",
];

// Маппинг настроений к тегам Jamendo
const MOOD_TO_TAGS = {
  epic: ["epic", "cinematic", "dramatic", "powerful"],
  calm: ["calm", "peaceful", "relaxing", "ambient"],
  energetic: ["energetic", "upbeat", "dynamic", "driving"],
  dark: ["dark", "mysterious", "tense", "suspense"],
  happy: ["happy", "joyful", "cheerful", "positive"],
  sad: ["sad", "melancholic", "emotional", "nostalgic"],
  intense: ["intense", "action", "aggressive", "heavy"],
  romantic: ["romantic", "love", "tender", "soft"],
  inspiring: ["inspiring", "motivational", "uplifting", "hopeful"],
  mysterious: ["mysterious", "suspense", "eerie", "atmospheric"],
};

/**
 * Ищет музыку на Jamendo по параметрам
 * @param {object} params - Параметры поиска
 * @returns {Promise<Array>} - Массив треков
 */
async function searchTracks(params = {}) {
  const {
    query = "",
    tags = [],
    genres = [],
    mood = null,
    speed = null, // verylow, low, medium, high, veryhigh
    instrumental = true, // true = без вокала
    limit = 20,
    page = 1,
    order = "popularity_month",
  } = params;

  try {
    const requestParams = {
      limit,
      offset: (page - 1) * limit,
      order,
      include: "musicinfo",
      audioformat: "mp32", // Хорошее качество (VBR)
    };

    // Добавляем поисковый запрос
    if (query) {
      requestParams.search = query;
    }

    // Добавляем теги (жанры и настроения)
    const allTags = [...tags];

    // Добавляем жанры как теги
    if (genres.length > 0) {
      allTags.push(...genres);
    }

    // Добавляем теги настроения
    if (mood && MOOD_TO_TAGS[mood]) {
      allTags.push(...MOOD_TO_TAGS[mood]);
    }

    if (allTags.length > 0) {
      // Используем fuzzytags для OR-логики (более гибкий поиск)
      requestParams.fuzzytags = allTags.join("+");
    }

    // Фильтр по скорости
    if (speed) {
      requestParams.speed = speed;
    }

    // Только инструментальные треки (без вокала) - лучше для фоновой музыки
    if (instrumental) {
      requestParams.vocalinstrumental = "instrumental";
    }

    console.log(`[Jamendo] Searching tracks:`, {
      query,
      tags: allTags,
      speed,
      instrumental,
    });

    const response = await jamendoClient.get("/tracks", {
      params: requestParams,
    });

    const tracks = response.data.results || [];

    console.log(`[Jamendo] Found ${tracks.length} tracks`);

    // Форматируем результаты
    return tracks.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artist_name,
      artistId: track.artist_id,
      album: track.album_name,
      albumId: track.album_id,
      duration: track.duration, // в секундах
      audioUrl: track.audio, // URL для стриминга
      downloadUrl: track.audiodownload, // URL для скачивания
      imageUrl: track.album_image || track.image,
      genres: track.musicinfo?.tags?.genres || [],
      instruments: track.musicinfo?.tags?.instruments || [],
      moods: track.musicinfo?.tags?.vartags || [],
      speed: track.musicinfo?.speed || "medium",
      isInstrumental: track.musicinfo?.vocalinstrumental === "instrumental",
      waveform: track.waveform ? JSON.parse(track.waveform) : null,
      downloadAllowed: track.audiodownload_allowed,
      license: track.license_ccurl,
      pageUrl: track.shareurl,
    }));
  } catch (error) {
    console.error("[Jamendo] Search error:", error.message);
    return [];
  }
}

/**
 * Получает трек по ID
 * @param {string|number} trackId - ID трека
 * @returns {Promise<object|null>}
 */
async function getTrackById(trackId) {
  try {
    const response = await jamendoClient.get("/tracks", {
      params: {
        id: trackId,
        include: "musicinfo",
        audioformat: "mp32",
      },
    });

    const tracks = response.data.results || [];
    if (tracks.length === 0) return null;

    const track = tracks[0];

    return {
      id: track.id,
      name: track.name,
      artist: track.artist_name,
      artistId: track.artist_id,
      album: track.album_name,
      duration: track.duration,
      audioUrl: track.audio,
      downloadUrl: track.audiodownload,
      imageUrl: track.album_image || track.image,
      genres: track.musicinfo?.tags?.genres || [],
      instruments: track.musicinfo?.tags?.instruments || [],
      moods: track.musicinfo?.tags?.vartags || [],
      speed: track.musicinfo?.speed || "medium",
      isInstrumental: track.musicinfo?.vocalinstrumental === "instrumental",
      downloadAllowed: track.audiodownload_allowed,
      license: track.license_ccurl,
      pageUrl: track.shareurl,
    };
  } catch (error) {
    console.error("[Jamendo] Get track error:", error.message);
    return null;
  }
}

/**
 * Ищет музыку подходящую для темы с использованием AI-сгенерированных ключевых слов
 * @param {object} params - Параметры
 * @returns {Promise<Array>}
 */
async function searchMusicForTopic(params = {}) {
  const {
    keywords = [],
    mood = null,
    tempo = "medium", // slow, medium, fast
    limit = 10,
  } = params;

  // Преобразуем tempo в speed для Jamendo
  const speedMap = {
    slow: ["verylow", "low"],
    medium: ["medium"],
    fast: ["high", "veryhigh"],
  };

  const speeds = speedMap[tempo] || ["medium"];

  // Ищем треки
  const tracks = await searchTracks({
    tags: keywords,
    mood,
    speed: speeds.join("+"),
    instrumental: true,
    limit,
    order: "popularity_month",
  });

  return tracks;
}

/**
 * Получает популярные треки по жанру (для fallback)
 * @param {string} genre - Жанр
 * @param {number} limit - Лимит
 * @returns {Promise<Array>}
 */
async function getPopularByGenre(genre = "electronic", limit = 10) {
  return searchTracks({
    genres: [genre],
    instrumental: true,
    limit,
    order: "popularity_month",
  });
}

/**
 * Получает рекомендуемую музыку для типичных тем YouTube Shorts
 * @param {string} themeType - Тип темы
 * @returns {Promise<Array>}
 */
async function getRecommendedForTheme(themeType = "general") {
  const themePresets = {
    facts: {
      tags: ["background", "corporate", "documentary"],
      mood: "inspiring",
    },
    mythology: { tags: ["epic", "cinematic", "orchestral"], mood: "epic" },
    science: {
      tags: ["electronic", "futuristic", "ambient"],
      mood: "mysterious",
    },
    history: { tags: ["cinematic", "orchestral", "dramatic"], mood: "epic" },
    technology: {
      tags: ["electronic", "modern", "digital"],
      mood: "energetic",
    },
    nature: { tags: ["ambient", "peaceful", "acoustic"], mood: "calm" },
    motivation: {
      tags: ["inspiring", "uplifting", "powerful"],
      mood: "inspiring",
    },
    horror: { tags: ["dark", "suspense", "eerie"], mood: "dark" },
    comedy: { tags: ["fun", "quirky", "playful"], mood: "happy" },
    general: { tags: ["background", "corporate", "neutral"], mood: null },
  };

  const preset = themePresets[themeType] || themePresets.general;

  return searchTracks({
    tags: preset.tags,
    mood: preset.mood,
    instrumental: true,
    limit: 15,
    order: "popularity_month",
  });
}

module.exports = {
  searchTracks,
  getTrackById,
  searchMusicForTopic,
  getPopularByGenre,
  getRecommendedForTheme,
  MUSIC_GENRES,
  MOOD_TO_TAGS,
};
