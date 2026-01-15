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
 * @returns {Promise<{path: string, duration: number}>} - Путь и длительность аудио
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
    // Добавляем --rate для ускорения речи и --pitch для энергичности
    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" --rate="+25%" --pitch="+5Hz" --file "${textFilePath}" --write-media "${outputPath}"`;

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

        // Получаем длительность аудио
        try {
          const duration = await getAudioDuration(outputPath);
          console.log(`Audio duration: ${duration.toFixed(2)}s`);
          resolve({
            path: `storage/audio/${filename}`,
            duration: duration,
          });
        } catch (durError) {
          // Если не удалось получить длительность, возвращаем 3 секунды по умолчанию
          resolve({
            path: `storage/audio/${filename}`,
            duration: 3,
          });
        }
      }
    );
  });
}

/**
 * Получает длительность аудио файла (для синхронизации с видео)
 * Использует music-metadata вместо ffprobe
 * @param {string} audioPath - Путь к аудио файлу
 * @returns {Promise<number>} - Длительность в секундах
 */
async function getAudioDuration(audioPath) {
  const { parseFile } = await import("music-metadata");

  try {
    const metadata = await parseFile(audioPath);
    return metadata.format.duration || 5; // По умолчанию 5 секунд
  } catch (error) {
    console.error("Error getting audio duration:", error.message);
    // Оцениваем длительность по размеру файла (примерно 16KB/сек для mp3 128kbps)
    const fsSync = require("fs");
    const stats = fsSync.statSync(audioPath);
    const estimatedDuration = stats.size / 16000;
    return Math.max(2, estimatedDuration); // Минимум 2 секунды
  }
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
    // Добавляем --rate для ускорения речи и --pitch для энергичности
    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" --rate="+25%" --pitch="+5Hz" --file "${textFilePath}" --write-media "${outputPath}"`;

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
