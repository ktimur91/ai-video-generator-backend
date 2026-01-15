const axios = require("axios");

const PIXABAY_API_KEY =
  process.env.PIXABAY_API_KEY || "54210869-6670fd220da2b2c1de7759e59";

const pixabayClient = axios.create({
  baseURL: "https://pixabay.com/api",
  params: {
    key: PIXABAY_API_KEY,
  },
});

/**
 * Ищет видео на Pixabay по ключевым словам (только вертикальные)
 * @param {string[]} keywords - Массив ключевых слов для поиска
 * @param {object} options - Опции поиска
 * @returns {Promise<object|null>} - Видео объект или null
 */
async function searchVideo(keywords, options = {}) {
  const { minDuration = 5, maxDuration = 30 } = options;

  // Пробуем каждое ключевое слово по очереди
  for (const keyword of keywords) {
    try {
      console.log(`[Pixabay] Searching for: "${keyword}"`);

      const response = await pixabayClient.get("/videos/", {
        params: {
          q: keyword,
          per_page: 20,
          video_type: "film", // Качественные видео
          safesearch: true,
        },
      });

      const videos = response.data.hits || [];

      // Фильтруем: только вертикальные + подходящая длительность
      const suitable = videos.filter((v) => {
        const isVertical = v.videos?.medium?.height > v.videos?.medium?.width;
        const durationOk =
          v.duration >= minDuration && v.duration <= maxDuration;
        return isVertical && durationOk;
      });

      if (suitable.length > 0) {
        // Выбираем случайное видео из подходящих
        const video = suitable[Math.floor(Math.random() * suitable.length)];

        // Находим лучший видеофайл (предпочитаем medium или large для вертикального)
        const videoFile = findBestVideoFile(video.videos);

        if (videoFile) {
          console.log(
            `[Pixabay] Found video: ${video.id}, duration: ${video.duration}s`
          );
          return {
            id: video.id,
            url: videoFile.url,
            width: videoFile.width,
            height: videoFile.height,
            duration: video.duration,
            photographer: video.user,
          };
        }
      }
    } catch (error) {
      console.error(`[Pixabay] Error searching "${keyword}":`, error.message);
    }
  }

  console.log(`[Pixabay] No videos found for keywords: ${keywords.join(", ")}`);
  return null;
}

/**
 * Выбирает лучший видео файл (предпочтительно вертикальный HD)
 * @param {object} videos - Объект с видео файлами от Pixabay
 * @returns {object|null}
 */
function findBestVideoFile(videos) {
  if (!videos) return null;

  // Приоритет: large > medium > small (для лучшего качества)
  // Но только если видео вертикальное
  const priorities = ["large", "medium", "small"];

  for (const quality of priorities) {
    const file = videos[quality];
    if (file && file.height > file.width) {
      return file;
    }
  }

  // Если нет вертикальных, берем medium как fallback
  if (videos.medium) {
    return videos.medium;
  }

  return videos.small || null;
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
 * @returns {Promise<Array>} - Сегменты с добавленным stockVideo
 */
async function findVideosForSegments(segments) {
  const results = [];

  for (const segment of segments) {
    let video = await searchVideo(segment.searchKeywords || []);

    // Если видео не найдено, пробуем fallback ключевые слова
    if (!video) {
      console.log(
        `[Pixabay] Retry with fallback keywords for segment ${
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
    console.log(`[Pixabay] Retry with fallback keywords for ${type}`);
    const fallbackKeys = FALLBACK_KEYWORDS[type] || FALLBACK_KEYWORDS.general;
    video = await searchVideo(fallbackKeys, {
      minDuration: 3,
      maxDuration: 60,
    });
  }

  return video;
}

module.exports = {
  searchVideo,
  findVideosForSegments,
  searchSingleVideo,
};
