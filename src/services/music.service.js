const fs = require("fs").promises;
const path = require("path");

const MUSIC_DIR = path.join(__dirname, "../../storage/background-musics");

/**
 * Получает список всех доступных фоновых треков
 * @returns {Promise<string[]>} - Массив имён файлов
 */
async function getAvailableMusic() {
  try {
    const files = await fs.readdir(MUSIC_DIR);
    return files.filter(
      (f) => f.endsWith(".mp3") || f.endsWith(".wav") || f.endsWith(".ogg")
    );
  } catch (error) {
    console.error("Error reading music directory:", error);
    return [];
  }
}

/**
 * Получает рандомный фоновый трек
 * @returns {Promise<{path: string, url: string, filename: string} | null>}
 */
async function getRandomBackgroundMusic() {
  const tracks = await getAvailableMusic();

  if (tracks.length === 0) {
    console.log("[Music] No background music found");
    return null;
  }

  // Выбираем случайный трек
  const randomIndex = Math.floor(Math.random() * tracks.length);
  const filename = tracks[randomIndex];

  const relativePath = `storage/background-musics/${filename}`;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

  console.log(`[Music] Selected: ${filename}`);

  return {
    path: relativePath,
    url: `${backendUrl}/${relativePath}`,
    filename,
  };
}

module.exports = {
  getAvailableMusic,
  getRandomBackgroundMusic,
};
