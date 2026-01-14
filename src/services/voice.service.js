const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

const AUDIO_DIR = path.join(__dirname, "../../storage/audio");

// Путь к edge-tts CLI (Python)
const EDGE_TTS_PATH = "/Users/apple/Library/Python/3.9/bin/edge-tts";

/**
 * Генерирует аудио файл из текста с помощью Edge TTS CLI (Python)
 * @param {string} text - Текст для озвучивания
 * @param {string} videoId - ID видео для именования файла
 * @returns {Promise<string>} - Путь к созданному аудио файлу
 */
async function generateAudio(text, videoId) {
  const voice = process.env.TTS_VOICE || "ru-RU-DmitryNeural";
  const filename = `${videoId}.mp3`;
  const outputPath = path.join(AUDIO_DIR, filename);

  // Убедимся, что директория существует
  await fs.mkdir(AUDIO_DIR, { recursive: true });

  // Очищаем текст от эмодзи и специальных символов для TTS
  const cleanText = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Убираем эмодзи
    .replace(/[*#]/g, "") // Убираем markdown символы
    .replace(/\n+/g, " ") // Заменяем переносы на пробелы
    .trim();

  // Создаём временный файл с текстом (для длинных текстов)
  const textFilePath = path.join(AUDIO_DIR, `${videoId}.txt`);
  await fs.writeFile(textFilePath, cleanText, "utf-8");

  return new Promise((resolve, reject) => {
    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" --file "${textFilePath}" --write-media "${outputPath}"`;

    console.log("Executing TTS command:", command);

    exec(
      command,
      { maxBuffer: 1024 * 1024 * 10 },
      async (error, stdout, stderr) => {
        // Удаляем временный текстовый файл
        try {
          await fs.unlink(textFilePath);
        } catch (e) {
          // Игнорируем ошибку удаления
        }

        if (error) {
          console.error("TTS error:", error);
          console.error("Stderr:", stderr);
          reject(new Error(`Failed to generate audio: ${error.message}`));
          return;
        }

        if (stdout) {
          console.log("TTS stdout:", stdout);
        }

        console.log(`Audio generated successfully: ${outputPath}`);

        // Возвращаем относительный путь для хранения в БД
        resolve(`storage/audio/${filename}`);
      }
    );
  });
}

/**
 * Получает длительность аудио файла (для синхронизации с видео)
 * @param {string} audioPath - Путь к аудио файлу
 * @returns {Promise<number>} - Длительность в секундах
 */
async function getAudioDuration(audioPath) {
  const ffmpeg = require("fluent-ffmpeg");

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to get audio duration: ${err.message}`));
        return;
      }
      resolve(metadata.format.duration);
    });
  });
}

module.exports = {
  generateAudio,
  getAudioDuration,
};
