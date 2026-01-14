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

/**
 * Ищет видео для каждого сегмента
 * @param {Array} segments - Массив сегментов с searchKeywords
 * @returns {Promise<Array>} - Сегменты с добавленным stockVideoUrl
 */
async function findVideosForSegments(segments) {
  const results = [];

  for (const segment of segments) {
    const video = await searchVideo(segment.searchKeywords || []);

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
 * Скачивает видео в локальный файл
 * @param {string} url - URL видео
 * @param {string} outputPath - Путь для сохранения
 * @returns {Promise<void>}
 */
async function downloadVideo(url, outputPath) {
  const fs = require("fs");
  const path = require("path");

  // Создаем директорию если не существует
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  const writer = fs.createWriteStream(outputPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

module.exports = {
  searchVideo,
  findVideosForSegments,
  downloadVideo,
};
