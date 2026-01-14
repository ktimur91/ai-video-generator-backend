const fs = require("fs").promises;
const path = require("path");

const PREVIEWS_DIR = path.join(__dirname, "../../storage/video-previews");

/**
 * Получает список всех доступных заставок
 * @returns {Promise<string[]>} - Массив имён файлов заставок
 */
async function getAvailablePreviews() {
  try {
    const files = await fs.readdir(PREVIEWS_DIR);
    return files.filter(
      (f) => f.endsWith(".mp4") || f.endsWith(".webm") || f.endsWith(".mov")
    );
  } catch (error) {
    console.error("Error reading previews directory:", error);
    return [];
  }
}

/**
 * Получает рандомную заставку
 * @returns {Promise<{path: string, url: string} | null>}
 */
async function getRandomPreview() {
  const previews = await getAvailablePreviews();

  if (previews.length === 0) {
    console.log("[Preview] No preview videos found");
    return null;
  }

  // Выбираем случайную заставку
  const randomIndex = Math.floor(Math.random() * previews.length);
  const filename = previews[randomIndex];

  const relativePath = `storage/video-previews/${filename}`;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

  console.log(`[Preview] Selected: ${filename}`);

  return {
    path: relativePath,
    url: `${backendUrl}/${relativePath}`,
    filename,
  };
}

/**
 * Получает длительность заставки (примерно, по размеру файла)
 * Для более точного определения нужен ffprobe
 * @param {string} filename - Имя файла заставки
 * @returns {Promise<number>} - Длительность в секундах
 */
async function getPreviewDuration(filename) {
  try {
    const filePath = path.join(PREVIEWS_DIR, filename);
    const stats = await fs.stat(filePath);
    // Примерная оценка: 1MB = ~4 секунды для 1080p видео
    const estimatedSeconds = Math.max(2, Math.min(10, stats.size / 250000));
    return estimatedSeconds;
  } catch {
    return 3; // По умолчанию 3 секунды
  }
}

module.exports = {
  getAvailablePreviews,
  getRandomPreview,
  getPreviewDuration,
};
