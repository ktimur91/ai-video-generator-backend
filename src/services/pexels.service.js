const axios = require("axios");

const PEXELS_API_KEY =
  process.env.PEXELS_API_KEY ||
  "js7zzQQH8u0HaLesjtFvn9WOBSpgwH6rXXvtqFSCANXiQQvovLTeTMjO";

const pexelsClient = axios.create({
  baseURL: "https://api.pexels.com",
  headers: {
    Authorization: PEXELS_API_KEY,
  },
});

/**
 * Ищет видео на Pexels по ключевым словам
 * @param {string[]} keywords - Массив ключевых слов для поиска
 * @param {object} options - Опции поиска
 * @returns {Promise<object|null>} - Видео объект или null
 */
async function searchVideo(keywords, options = {}) {
  const {
    orientation = "portrait",
    minDuration = 5,
    maxDuration = 30,
  } = options;

  // Пробуем каждое ключевое слово по очереди
  for (const keyword of keywords) {
    try {
      console.log(`[Pexels] Searching for: "${keyword}"`);

      const response = await pexelsClient.get("/videos/search", {
        params: {
          query: keyword,
          orientation: orientation,
          per_page: 15,
          size: "medium",
        },
      });

      const videos = response.data.videos || [];

      // Фильтруем по длительности
      const suitable = videos.filter(
        (v) => v.duration >= minDuration && v.duration <= maxDuration
      );

      if (suitable.length > 0) {
        // Выбираем случайное видео из подходящих
        const video = suitable[Math.floor(Math.random() * suitable.length)];

        // Находим подходящий файл (HD качество, portrait)
        const videoFile = findBestVideoFile(video.video_files);

        if (videoFile) {
          console.log(
            `[Pexels] Found video: ${video.id}, duration: ${video.duration}s`
          );
          return {
            id: video.id,
            url: videoFile.link,
            width: videoFile.width,
            height: videoFile.height,
            duration: video.duration,
            photographer: video.user.name,
          };
        }
      }
    } catch (error) {
      console.error(`[Pexels] Error searching "${keyword}":`, error.message);
    }
  }

  console.log(`[Pexels] No videos found for keywords: ${keywords.join(", ")}`);
  return null;
}

/**
 * Выбирает лучший видео файл (предпочтительно HD portrait)
 * @param {Array} files - Массив video_files от Pexels
 * @returns {object|null}
 */
function findBestVideoFile(files) {
  if (!files || files.length === 0) return null;

  // Сортируем по качеству: предпочитаем HD (1080), потом SD (720)
  // Для Shorts нам нужно вертикальное видео (height > width)
  const sorted = files
    .filter((f) => f.height > f.width) // только вертикальные
    .sort((a, b) => {
      // Предпочитаем 1080p
      const aIs1080 = a.height >= 1080;
      const bIs1080 = b.height >= 1080;
      if (aIs1080 && !bIs1080) return -1;
      if (!aIs1080 && bIs1080) return 1;
      return b.height - a.height;
    });

  // Если нет вертикальных, берем любое
  if (sorted.length === 0) {
    return files.sort((a, b) => b.height - a.height)[0];
  }

  return sorted[0];
}

// Fallback ключевые слова для разных типов контента
const FALLBACK_KEYWORDS = {
  general: ["abstract", "nature", "city", "technology", "lifestyle"],
  intro: ["energy", "action", "motion", "dynamic", "colorful"],
  outro: ["social media", "phone", "technology", "happy people", "thumbs up"],
};

/**
 * Ищет видео для каждого сегмента с retry и fallback
 * @param {Array} segments - Массив сегментов с searchKeywords
 * @returns {Promise<Array>} - Сегменты с добавленным stockVideoUrl
 */
async function findVideosForSegments(segments) {
  const results = [];

  for (const segment of segments) {
    let video = await searchVideo(segment.searchKeywords || []);

    // Если видео не найдено, пробуем fallback ключевые слова
    if (!video) {
      console.log(
        `[Pexels] Retry with fallback keywords for segment ${
          segment.number || "unknown"
        }`
      );
      video = await searchVideo(FALLBACK_KEYWORDS.general);
    }

    results.push({
      ...segment,
      stockVideo: video,
    });

    // Небольшая пауза между запросами чтобы не превысить rate limit
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return results;
}

/**
 * Ищет одно видео по ключевым словам (для intro/outro) с fallback
 * @param {string[]} keywords - Ключевые слова
 * @param {string} type - Тип: 'intro' или 'outro'
 * @returns {Promise<object|null>}
 */
async function searchSingleVideo(keywords, type = "general") {
  let video = await searchVideo(keywords, { minDuration: 3, maxDuration: 60 });

  // Если не найдено, пробуем fallback
  if (!video) {
    console.log(`[Pexels] Retry with fallback keywords for ${type}`);
    const fallbackKeys = FALLBACK_KEYWORDS[type] || FALLBACK_KEYWORDS.general;
    video = await searchVideo(fallbackKeys, {
      minDuration: 3,
      maxDuration: 60,
    });
  }

  return video;
}

/**
 * Ищет видео и возвращает ВСЕ подходящие с превью для AI-выбора
 * @param {string[]} keywords - Массив ключевых слов для поиска
 * @param {object} options - Опции поиска
 * @returns {Promise<Array>} - Массив видео с thumbnailUrl
 */
async function searchVideosWithThumbnails(keywords, options = {}) {
  const {
    orientation = "portrait",
    minDuration = 5,
    maxDuration = 30,
  } = options;

  const allVideos = [];

  // Пробуем первое ключевое слово (обычно самое релевантное)
  const keyword = keywords[0];
  if (!keyword) return [];

  try {
    console.log(`[Pexels] Searching with thumbnails for: "${keyword}"`);

    const response = await pexelsClient.get("/videos/search", {
      params: {
        query: keyword,
        orientation: orientation,
        per_page: 15,
        size: "medium",
      },
    });

    const videos = response.data.videos || [];

    // Фильтруем по длительности
    const suitable = videos.filter(
      (v) => v.duration >= minDuration && v.duration <= maxDuration
    );

    for (const video of suitable) {
      const videoFile = findBestVideoFile(video.video_files);
      if (videoFile) {
        allVideos.push({
          id: video.id,
          url: videoFile.link,
          width: videoFile.width,
          height: videoFile.height,
          duration: video.duration,
          photographer: video.user.name,
          thumbnailUrl: video.image, // Pexels предоставляет превью
          source: "pexels",
        });
      }
    }

    console.log(`[Pexels] Found ${allVideos.length} suitable videos`);
  } catch (error) {
    console.error(`[Pexels] Error searching "${keyword}":`, error.message);
  }

  return allVideos;
}

module.exports = {
  searchVideo,
  findVideosForSegments,
  searchSingleVideo,
  searchVideosWithThumbnails,
};
