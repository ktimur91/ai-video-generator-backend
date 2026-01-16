const axios = require("axios");

const KLIPY_API_KEY = process.env.KLIPY_API_KEY;

/**
 * Klipy API использует Tenor-совместимый формат:
 * - Endpoint: /v2/search
 * - Параметр ключа: key (query param, не header!)
 * - Ответ: { results: [...], next: "..." }
 */

const klipyClient = axios.create({
  baseURL: "https://api.klipy.com",
});

/**
 * Извлекает данные видео (MP4) из объекта результата Klipy
 * @param {object} item - Объект результата от Klipy
 * @returns {object|null} - { url, width, height }
 */
function extractVideoData(item) {
  const formats = item.media_formats;
  if (!formats) return null;

  // Приоритет: mp4 > loopedmp4 > tinymp4 > webm > gif
  if (formats.mp4?.url) {
    return {
      url: formats.mp4.url,
      width: formats.mp4.dims?.[0] || 640,
      height: formats.mp4.dims?.[1] || 360,
    };
  }
  if (formats.loopedmp4?.url) {
    return {
      url: formats.loopedmp4.url,
      width: formats.loopedmp4.dims?.[0] || 640,
      height: formats.loopedmp4.dims?.[1] || 360,
    };
  }
  if (formats.tinymp4?.url) {
    return {
      url: formats.tinymp4.url,
      width: formats.tinymp4.dims?.[0] || 320,
      height: formats.tinymp4.dims?.[1] || 180,
    };
  }
  if (formats.webm?.url) {
    return {
      url: formats.webm.url,
      width: formats.webm.dims?.[0] || 640,
      height: formats.webm.dims?.[1] || 360,
    };
  }
  if (formats.gif?.url) {
    return {
      url: formats.gif.url,
      width: formats.gif.dims?.[0] || 498,
      height: formats.gif.dims?.[1] || 280,
    };
  }

  return null;
}

/**
 * Ищет GIF/видео на Klipy по ключевым словам
 * @param {string[]} keywords - Массив ключевых слов для поиска
 * @param {object} options - Опции поиска
 * @returns {Promise<object|null>} - Видео объект или null
 */
async function searchVideo(keywords, options = {}) {
  // Пробуем каждое ключевое слово по очереди
  for (const keyword of keywords) {
    try {
      console.log(`[Klipy] Searching for: "${keyword}"`);

      const response = await klipyClient.get("/v2/search", {
        params: {
          q: keyword,
          key: KLIPY_API_KEY,
          limit: 20,
        },
      });

      const results = response.data.results || [];

      if (results.length > 0) {
        // Выбираем случайный результат
        const item = results[Math.floor(Math.random() * results.length)];

        // Извлекаем данные видео
        const videoData = extractVideoData(item);

        if (videoData) {
          console.log(
            `[Klipy] Found: ${item.id} - ${item.title || "untitled"}`
          );
          return {
            id: item.id,
            url: videoData.url,
            width: videoData.width,
            height: videoData.height,
            duration: 5, // Klipy не возвращает duration
            photographer: "Klipy",
            isVertical: videoData.height > videoData.width,
          };
        }
      }
    } catch (error) {
      console.error(`[Klipy] Error searching "${keyword}":`, error.message);
    }
  }

  console.log(`[Klipy] No results found for keywords: ${keywords.join(", ")}`);
  return null;
}

/**
 * Поиск для ручного выбора в редакторе
 * @param {string} query - Поисковый запрос
 * @param {object} options - Опции
 * @returns {Promise<object>}
 */
async function searchClips(query, options = {}) {
  const { page = 1, limit = 20, pos = null } = options;

  try {
    console.log(`[Klipy Search] Query: ${query}, Page: ${page}`);

    const params = {
      q: query,
      key: KLIPY_API_KEY,
      limit: limit,
    };

    // Для пагинации используем pos (next token)
    if (pos) {
      params.pos = pos;
    }

    const response = await klipyClient.get("/v2/search", { params });

    const results = response.data.results || [];
    const nextPos = response.data.next || null;

    const videos = results
      .map((item) => {
        const videoData = extractVideoData(item);
        if (!videoData) return null;

        // Для превью берём gif или preview
        const thumbnail =
          item.media_formats?.gifpreview?.url ||
          item.media_formats?.tinygifpreview?.url ||
          item.media_formats?.nanogifpreview?.url ||
          videoData.url;

        return {
          id: item.id,
          url: videoData.url,
          width: videoData.width,
          height: videoData.height,
          duration: 5,
          photographer: "Klipy",
          thumbnail: thumbnail,
          isVertical: videoData.height > videoData.width,
        };
      })
      .filter(Boolean);

    return {
      videos,
      hasMore: !!nextPos,
      nextPos,
      page,
    };
  } catch (error) {
    console.error(`[Klipy Search] Error:`, error.message);
    return { videos: [], hasMore: false, page };
  }
}

// Fallback ключевые слова для разных типов контента
const FALLBACK_KEYWORDS = {
  general: ["funny", "reaction", "wow", "amazing", "cool"],
  intro: ["excited", "energy", "hello", "hi", "welcome"],
  outro: ["bye", "thanks", "thumbs up", "subscribe", "wave"],
};

/**
 * Ищет одно видео по ключевым словам (для intro/outro) с fallback
 * @param {string[]} keywords - Ключевые слова
 * @param {string} type - Тип: 'intro' или 'outro'
 * @returns {Promise<object|null>}
 */
async function searchSingleVideo(keywords, type = "general") {
  let video = await searchVideo(keywords);

  // Если не найдено, пробуем fallback
  if (!video) {
    console.log(`[Klipy] Retry with fallback keywords for ${type}`);
    const fallbackKeys = FALLBACK_KEYWORDS[type] || FALLBACK_KEYWORDS.general;
    video = await searchVideo(fallbackKeys);
  }

  return video;
}

module.exports = {
  searchVideo,
  searchClips,
  searchSingleVideo,
};
