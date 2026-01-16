const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Транскрибирует аудио файл и возвращает слова с таймингами
 * @param {string} audioPath - Путь к аудио файлу
 * @returns {Promise<Array<{word: string, start: number, end: number}>>}
 */
async function transcribeWithTimings(audioPath) {
  console.log(`[Whisper] Transcribing: ${audioPath}`);

  try {
    // Проверяем что файл существует
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "ru",
    });

    // Whisper возвращает слова с таймингами
    const words = response.words || [];

    console.log(`[Whisper] Transcribed ${words.length} words`);

    return words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));
  } catch (error) {
    console.error("[Whisper] Transcription error:", error.message);
    // Возвращаем пустой массив если транскрипция не удалась
    return [];
  }
}

/**
 * Генерирует тайминги для слов на основе равномерного распределения
 * (fallback если Whisper не доступен)
 * @param {string} text - Текст
 * @param {number} duration - Длительность в секундах
 * @returns {Array<{word: string, start: number, end: number}>}
 */
function generateFallbackTimings(text, duration) {
  const words = text.split(/\s+/).filter((w) => w.trim());
  const wordDuration = duration / words.length;

  return words.map((word, index) => ({
    word,
    start: index * wordDuration,
    end: (index + 1) * wordDuration,
  }));
}

module.exports = {
  transcribeWithTimings,
  generateFallbackTimings,
};
