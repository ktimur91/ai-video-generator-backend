const { EdgeTTS } = require("edge-tts-node");
const path = require("path");
const fs = require("fs").promises;

const AUDIO_DIR = path.join(__dirname, "../../storage/audio");

/**
 * Генерирует аудио файл из текста с помощью Edge TTS
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

  try {
    const tts = new EdgeTTS();

    await tts.synthesize(text, voice, {
      outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    });

    await tts.toFile(outputPath);

    console.log(`Audio generated successfully: ${outputPath}`);

    // Возвращаем относительный путь для хранения в БД
    return `storage/audio/${filename}`;
  } catch (error) {
    console.error("Error generating audio:", error);
    throw new Error(`Failed to generate audio: ${error.message}`);
  }
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
