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

/**
 * Генерирует аудио для одного сегмента
 * @param {string} text - Текст сегмента
 * @param {string} videoId - ID видео
 * @param {number} segmentNumber - Номер сегмента
 * @returns {Promise<{path: string, duration: number}>}
 */
async function generateSegmentAudio(text, videoId, segmentNumber) {
  const voice = process.env.TTS_VOICE || "ru-RU-DmitryNeural";
  const filename = `${videoId}_segment_${segmentNumber}.mp3`;
  const outputPath = path.join(AUDIO_DIR, filename);

  // Убедимся, что директория существует
  await fs.mkdir(AUDIO_DIR, { recursive: true });

  // Очищаем текст от эмодзи и специальных символов для TTS
  const cleanText = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[*#]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  // Создаём временный файл с текстом
  const textFilePath = path.join(
    AUDIO_DIR,
    `${videoId}_segment_${segmentNumber}.txt`
  );
  await fs.writeFile(textFilePath, cleanText, "utf-8");

  return new Promise((resolve, reject) => {
    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" --file "${textFilePath}" --write-media "${outputPath}"`;

    console.log(
      `Generating audio for segment ${segmentNumber}:`,
      cleanText.substring(0, 50) + "..."
    );

    exec(
      command,
      { maxBuffer: 1024 * 1024 * 10 },
      async (error, stdout, stderr) => {
        // Удаляем временный текстовый файл
        try {
          await fs.unlink(textFilePath);
        } catch (e) {}

        if (error) {
          console.error("TTS error:", error);
          reject(
            new Error(`Failed to generate segment audio: ${error.message}`)
          );
          return;
        }

        // Получаем длительность аудио
        try {
          const duration = await getAudioDuration(outputPath);
          console.log(
            `Segment ${segmentNumber} audio: ${duration.toFixed(2)}s`
          );

          resolve({
            path: `storage/audio/${filename}`,
            duration: duration,
          });
        } catch (durError) {
          reject(durError);
        }
      }
    );
  });
}

/**
 * Генерирует аудио для всех сегментов видео
 * @param {Array} segments - Массив сегментов с text
 * @param {string} videoId - ID видео
 * @param {function} onProgress - Callback для прогресса
 * @returns {Promise<Array>} - Сегменты с добавленными audioPath и audioDuration
 */
async function generateSegmentsAudio(segments, videoId, onProgress) {
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (onProgress) {
      onProgress(`Генерация аудио ${i + 1}/${segments.length}`);
    }

    const audio = await generateSegmentAudio(
      segment.text,
      videoId,
      segment.number
    );

    results.push({
      ...segment,
      audioPath: audio.path,
      audioDuration: audio.duration,
    });
  }

  return results;
}

module.exports = {
  generateAudio,
  getAudioDuration,
  generateSegmentAudio,
  generateSegmentsAudio,
};
