const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const { transcribeWithTimings } = require("./whisper.service");

const AUDIO_DIR = path.join(__dirname, "../../storage/audio");

// Путь к edge-tts CLI (Python)
// Приоритет: переменная окружения > просто команда (если в PATH)
const EDGE_TTS_PATH = process.env.EDGE_TTS_PATH || "edge-tts";

/**
 * Словарь замен английских слов на фонетическую транскрипцию для русского TTS
 * Ключ - регулярное выражение (case-insensitive), значение - произношение
 */
const PRONUNCIATION_DICT = {
  // Языки программирования
  Python: "Пайтон",
  JavaScript: "ДжаваСкрипт",
  TypeScript: "ТайпСкрипт",
  Java: "Джава",
  "C\\+\\+": "Си плюс плюс",
  "C#": "Си шарп",
  Ruby: "Руби",
  Rust: "Раст",
  "Go(?:lang)?": "Гоу",
  Swift: "Свифт",
  Kotlin: "Котлин",
  Scala: "Скала",
  PHP: "Пи Эйч Пи",
  SQL: "Эс Кью Эль",
  HTML: "Эйч Ти Эм Эль",
  CSS: "Си Эс Эс",
  React: "Риэкт",
  Vue: "Вью",
  Angular: "Ангуляр",
  "Node\\.?js": "Ноуд Джей Эс",
  Express: "Экспресс",
  Django: "Джанго",
  Flask: "Фласк",
  Laravel: "Ларавел",
  Spring: "Спринг",

  // Технологии и компании
  API: "Эй Пи Ай",
  REST: "Рест",
  GraphQL: "Граф Кью Эль",
  Docker: "Докер",
  Kubernetes: "Кубернетис",
  AWS: "Эй Дабл Ю Эс",
  Azure: "Эжур",
  Google: "Гугл",
  GitHub: "ГитХаб",
  GitLab: "ГитЛаб",
  Linux: "Линукс",
  Windows: "Виндоус",
  macOS: "Мак О Эс",
  iOS: "Ай О Эс",
  Android: "Андроид",
  Chrome: "Хром",
  Firefox: "Файрфокс",
  Safari: "Сафари",
  Edge: "Эдж",
  Microsoft: "Майкрософт",
  Apple: "Эпл",
  Amazon: "Амазон",
  Netflix: "Нетфликс",
  Spotify: "Спотифай",
  Tesla: "Тесла",
  SpaceX: "Спейс Икс",
  NASA: "НАСА",
  OpenAI: "Оупен Эй Ай",
  ChatGPT: "Чат Джи Пи Ти",
  GPT: "Джи Пи Ти",
  AI: "Ай Ай",
  ML: "Эм Эль",
  "Deep Learning": "Дип Лёрнинг",
  "Machine Learning": "Машин Лёрнинг",
  Blockchain: "Блокчейн",
  Bitcoin: "Биткоин",
  Ethereum: "Эфириум",
  NFT: "Эн Эф Ти",
  VR: "Ви Ар",
  AR: "Эй Ар",

  // Социальные сети
  YouTube: "Ютуб",
  TikTok: "ТикТок",
  Instagram: "Инстаграм",
  Facebook: "Фейсбук",
  Twitter: "Твиттер",
  LinkedIn: "ЛинкедИн",
  WhatsApp: "Вотсап",
  Telegram: "Телеграм",
  Discord: "Дискорд",
  Twitch: "Твич",
  Reddit: "Реддит",
  Pinterest: "Пинтерест",
  Snapchat: "Снэпчат",

  // Общие английские слова
  online: "онлайн",
  offline: "офлайн",
  startup: "стартап",
  smartphone: "смартфон",
  laptop: "ноутбук",
  software: "софтвер",
  hardware: "хардвер",
  update: "апдейт",
  upgrade: "апгрейд",
  download: "даунлоуд",
  upload: "аплоуд",
  email: "имейл",
  "e-mail": "имейл",
  website: "вебсайт",
  web: "веб",
  internet: "интернет",
  WiFi: "Вай Фай",
  "Wi-Fi": "Вай Фай",
  Bluetooth: "Блютус",
  USB: "Ю Эс Би",
  SSD: "Эс Эс Ди",
  HDD: "Эйч Ди Ди",
  RAM: "Рам",
  CPU: "Си Пи Ю",
  GPU: "Джи Пи Ю",
  FPS: "Эф Пи Эс",
  HD: "Эйч Ди",
  "4K": "Четыре Ка",
  "8K": "Восемь Ка",
  OLED: "Оулед",
  LED: "Лед",
  LCD: "Эль Си Ди",

  // Бизнес термины
  CEO: "Си И Оу",
  CTO: "Си Ти Оу",
  CFO: "Си Эф Оу",
  HR: "Эйч Ар",
  PR: "Пи Ар",
  B2B: "Би Ту Би",
  B2C: "Би Ту Си",
  ROI: "Ар Оу Ай",
  KPI: "Ке Пи Ай",
  MBA: "Эм Би Эй",

  // Единицы и форматы
  PDF: "Пи Ди Эф",
  JPEG: "Джейпег",
  JPG: "Джейпег",
  PNG: "Пи Эн Джи",
  GIF: "Гиф",
  MP3: "Эм Пи Три",
  MP4: "Эм Пи Четыре",
  GB: "Гигабайт",
  MB: "Мегабайт",
  KB: "Килобайт",
  TB: "Терабайт",
};

/**
 * Заменяет английские слова на их фонетическое представление для TTS
 * @param {string} text - Исходный текст
 * @returns {string} - Текст с заменами
 */
function applyPronunciationFixes(text) {
  let result = text;

  for (const [pattern, replacement] of Object.entries(PRONUNCIATION_DICT)) {
    // Используем word boundaries для точного совпадения слов
    const regex = new RegExp(`\\b${pattern}\\b`, "gi");
    result = result.replace(regex, replacement);
  }

  return result;
}

/**
 * Генерирует аудио файл из текста с помощью Edge TTS CLI (Python)
 * @param {string} text - Текст для озвучивания
 * @param {string} videoId - ID видео для именования файла
 * @param {object} voiceConfig - Настройки голоса (опционально)
 * @returns {Promise<{path: string, duration: number}>} - Путь и длительность аудио
 */
async function generateAudio(text, videoId, voiceConfig = null) {
  // Используем настройки из конфига или дефолтные значения
  const voice =
    voiceConfig?.voice || process.env.TTS_VOICE || "ru-RU-DmitryNeural";
  const rate = voiceConfig?.rate || "+25%";
  const pitch = voiceConfig?.pitch || "+5Hz";
  const volume = voiceConfig?.volume || "+0%";

  console.log(
    `[TTS] Using voice: ${voice}, rate: ${rate}, pitch: ${pitch}, volume: ${volume}`,
  );

  const filename = `${videoId}.mp3`;
  const outputPath = path.join(AUDIO_DIR, filename);

  // Убедимся, что директория существует
  await fs.mkdir(AUDIO_DIR, { recursive: true });

  // Очищаем текст от эмодзи и специальных символов для TTS
  let cleanText = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "") // Убираем эмодзи
    .replace(/[*#]/g, "") // Убираем markdown символы
    .replace(/\n+/g, " ") // Заменяем переносы на пробелы
    .trim();

  // Применяем замены для правильного произношения английских слов
  cleanText = applyPronunciationFixes(cleanText);
  console.log("[TTS] Text after pronunciation fixes:", cleanText);

  // Создаём временный файл с текстом (для длинных текстов)
  const textFilePath = path.join(AUDIO_DIR, `${videoId}.txt`);
  await fs.writeFile(textFilePath, cleanText, "utf-8");

  return new Promise((resolve, reject) => {
    // Формируем команду с параметрами из конфига
    const rateParam = rate ? `--rate="${rate}"` : "";
    const pitchParam = pitch ? `--pitch="${pitch}"` : "";
    const volumeParam =
      volume && volume !== "+0%" ? `--volume="${volume}"` : "";

    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" ${rateParam} ${pitchParam} ${volumeParam} --file "${textFilePath}" --write-media "${outputPath}"`;

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
      },
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
  let cleanText = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[*#]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  // Применяем замены для правильного произношения английских слов
  cleanText = applyPronunciationFixes(cleanText);
  console.log(
    `[TTS] Segment ${segmentNumber} text after fixes:`,
    cleanText.substring(0, 80) + "...",
  );

  // Создаём временный файл с текстом
  const textFilePath = path.join(
    AUDIO_DIR,
    `${videoId}_segment_${segmentNumber}.txt`,
  );
  await fs.writeFile(textFilePath, cleanText, "utf-8");

  return new Promise((resolve, reject) => {
    // Добавляем --rate для ускорения речи и --pitch для энергичности
    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" --rate="+25%" --pitch="+5Hz" --file "${textFilePath}" --write-media "${outputPath}"`;

    console.log(
      `Generating audio for segment ${segmentNumber}:`,
      cleanText.substring(0, 50) + "...",
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
            new Error(`Failed to generate segment audio: ${error.message}`),
          );
          return;
        }

        // Получаем длительность аудио
        try {
          const duration = await getAudioDuration(outputPath);
          console.log(
            `Segment ${segmentNumber} audio: ${duration.toFixed(2)}s`,
          );

          resolve({
            path: `storage/audio/${filename}`,
            duration: duration,
          });
        } catch (durError) {
          reject(durError);
        }
      },
    );
  });
}

/**
 * Генерирует аудио для всех сегментов видео
 * @param {Array} segments - Массив сегментов с text
 * @param {string} videoId - ID видео
 * @param {function} onProgress - Callback для прогресса
 * @returns {Promise<Array>} - Сегменты с добавленными audioPath, audioDuration и wordTimings
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
      segment.number,
    );

    // Транскрибируем аудио для получения таймингов слов
    let wordTimings = [];
    try {
      const fullAudioPath = path.join(__dirname, "../../", audio.path);
      wordTimings = await transcribeWithTimings(fullAudioPath);
      console.log(
        `[Whisper] Segment ${segment.number}: ${wordTimings.length} words with timings`,
      );
    } catch (err) {
      console.error(
        `[Whisper] Failed for segment ${segment.number}:`,
        err.message,
      );
    }

    results.push({
      ...segment,
      audioPath: audio.path,
      audioDuration: audio.duration,
      wordTimings, // Массив: [{word: "привет", start: 0.1, end: 0.5}, ...]
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
