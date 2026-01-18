const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

const VIDEOS_DIR = path.join(__dirname, "../../storage/videos");
const FRONT_RENDER_DIR = path.join(__dirname, "../../../front-render");

/**
 * Запускает рендеринг видео через Remotion CLI
 * @param {object} video - Объект видео из БД
 * @param {string} video.id - ID видео
 * @param {string} video.title - Заголовок видео
 * @param {string} video.scriptText - Текст сценария
 * @param {string} video.segments - JSON строка с сегментами
 * @param {string} video.backgroundMusicUrl - URL фоновой музыки (Jamendo)
 * @param {string} video.backgroundMusicData - JSON с полными данными трека
 * @returns {Promise<string>} - Путь к созданному видео файлу
 */
async function renderVideo(video) {
  const {
    id,
    title,
    scriptText,
    segments: segmentsJson,
    backgroundMusicUrl,
    backgroundMusicData,
  } = video;
  const outputFilename = `${id}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, outputFilename);

  // Убедимся, что директория существует
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  // Парсим сегменты (могут прийти как строка или как массив)
  const segments = segmentsJson
    ? typeof segmentsJson === "string"
      ? JSON.parse(segmentsJson)
      : segmentsJson
    : [];

  // Backend URL для формирования HTTP ссылок
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

  // Преобразуем пути к аудио в HTTP URLs
  const segmentsWithUrls = segments.map((segment) => ({
    ...segment,
    audioUrl: segment.audioPath ? `${backendUrl}/${segment.audioPath}` : null,
  }));

  // Определяем URL фоновой музыки
  // Приоритет: backgroundMusicData.downloadUrl > backgroundMusicUrl
  let finalBackgroundMusicUrl = null;

  if (backgroundMusicData) {
    try {
      const musicData =
        typeof backgroundMusicData === "string"
          ? JSON.parse(backgroundMusicData)
          : backgroundMusicData;
      // Используем downloadUrl (полный файл), audioUrl (stream) или url (старый формат)
      finalBackgroundMusicUrl =
        musicData.downloadUrl || musicData.audioUrl || musicData.url || null;
    } catch (e) {
      console.error("[Render] Failed to parse backgroundMusicData:", e);
    }
  }

  // Fallback на backgroundMusicUrl если data не работает
  if (!finalBackgroundMusicUrl && backgroundMusicUrl) {
    finalBackgroundMusicUrl = backgroundMusicUrl;
  }

  console.log(
    `[Render] Background music: ${finalBackgroundMusicUrl || "none"}`,
  );

  // Подготовка props для Remotion (с глобальной фоновой музыкой)
  const props = JSON.stringify({
    title,
    scriptText: scriptText,
    segments: segmentsWithUrls,
    backgroundMusicUrl: finalBackgroundMusicUrl,
  });

  // Экранируем props для shell
  const escapedProps = props.replace(/'/g, "'\\''");

  // Формируем команду для Remotion CLI
  // Используем SegmentVideo композицию для нового формата
  const composition = segments.length > 0 ? "SegmentVideo" : "MainVideo";
  const command = `cd "${FRONT_RENDER_DIR}" && npx remotion render src/index.ts ${composition} "${outputPath}" --props='${escapedProps}'`;

  console.log("Executing render command:", command);
  console.log("Segments count:", segments.length);

  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error("Render error:", error);
        console.error("Stderr:", stderr);
        reject(new Error(`Render failed: ${error.message}`));
        return;
      }

      console.log("Render stdout:", stdout);

      if (stderr) {
        console.log("Render stderr:", stderr);
      }

      // Возвращаем относительный путь для хранения в БД
      resolve(`storage/videos/${outputFilename}`);
    });
  });
}

/**
 * Проверяет, установлен ли Remotion в front-render
 * @returns {Promise<boolean>}
 */
async function checkRemotionInstalled() {
  try {
    await fs.access(path.join(FRONT_RENDER_DIR, "node_modules", "@remotion"));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  renderVideo,
  checkRemotionInstalled,
};
