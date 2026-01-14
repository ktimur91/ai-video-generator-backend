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
 * @param {string} video.audioPath - Путь к аудио файлу
 * @returns {Promise<string>} - Путь к созданному видео файлу
 */
async function renderVideo(video) {
  const { id, title, scriptText, audioPath } = video;
  const outputFilename = `${id}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, outputFilename);

  // Убедимся, что директория существует
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  // Подготовка props для Remotion
  const props = JSON.stringify({
    title,
    script: scriptText,
    audioPath: path.resolve(__dirname, "../../", audioPath),
  });

  // Экранируем props для shell
  const escapedProps = props.replace(/'/g, "'\\''");

  // Формируем команду для Remotion CLI
  // Формат: npx remotion render <entry-file> <composition-id> <output-file>
  const command = `cd "${FRONT_RENDER_DIR}" && npx remotion render src/index.ts MainVideo "${outputPath}" --props='${escapedProps}'`;

  console.log("Executing render command:", command);

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
