const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const { generateTTS, isProviderAvailable } = require("../services/tts.service");

const prisma = new PrismaClient();

// Путь к edge-tts CLI (из переменной окружения или в PATH)
const EDGE_TTS_PATH = process.env.EDGE_TTS_PATH || "edge-tts";
const PREVIEW_DIR = path.join(__dirname, "../../storage/voice-previews");

// ============ TTS ПРОВАЙДЕРЫ ============

const TTS_PROVIDERS = [
  { id: "edge", name: "Edge TTS", desc: "Бесплатный, Microsoft" },
  { id: "openai", name: "OpenAI TTS", desc: "Платный, высокое качество" },
  { id: "gemini", name: "Gemini TTS", desc: "Google, экспериментальный" },
];

// ============ ГОЛОСА ПО ПРОВАЙДЕРАМ ============

// Edge TTS голоса
const EDGE_VOICES = [
  // Русские голоса
  { id: "ru-RU-DmitryNeural", name: "Дмитрий", lang: "ru-RU", gender: "male" },
  {
    id: "ru-RU-SvetlanaNeural",
    name: "Светлана",
    lang: "ru-RU",
    gender: "female",
  },
  // Английские голоса (USA)
  { id: "en-US-GuyNeural", name: "Guy (US)", lang: "en-US", gender: "male" },
  {
    id: "en-US-JennyNeural",
    name: "Jenny (US)",
    lang: "en-US",
    gender: "female",
  },
  {
    id: "en-US-AriaNeural",
    name: "Aria (US)",
    lang: "en-US",
    gender: "female",
  },
  {
    id: "en-US-DavisNeural",
    name: "Davis (US)",
    lang: "en-US",
    gender: "male",
  },
  { id: "en-US-TonyNeural", name: "Tony (US)", lang: "en-US", gender: "male" },
  // Английские голоса (UK)
  { id: "en-GB-RyanNeural", name: "Ryan (UK)", lang: "en-GB", gender: "male" },
  {
    id: "en-GB-SoniaNeural",
    name: "Sonia (UK)",
    lang: "en-GB",
    gender: "female",
  },
  // Украинские голоса
  { id: "uk-UA-OstapNeural", name: "Остап", lang: "uk-UA", gender: "male" },
  { id: "uk-UA-PolinaNeural", name: "Полина", lang: "uk-UA", gender: "female" },
];

// OpenAI TTS голоса (tts-1, tts-1-hd)
const OPENAI_VOICES = [
  {
    id: "alloy",
    name: "Alloy",
    lang: "multi",
    gender: "neutral",
    desc: "Нейтральный",
  },
  {
    id: "echo",
    name: "Echo",
    lang: "multi",
    gender: "male",
    desc: "Мужской, мягкий",
  },
  {
    id: "fable",
    name: "Fable",
    lang: "multi",
    gender: "male",
    desc: "Британский акцент",
  },
  {
    id: "onyx",
    name: "Onyx",
    lang: "multi",
    gender: "male",
    desc: "Глубокий, авторитетный",
  },
  {
    id: "nova",
    name: "Nova",
    lang: "multi",
    gender: "female",
    desc: "Женский, дружелюбный",
  },
  {
    id: "shimmer",
    name: "Shimmer",
    lang: "multi",
    gender: "female",
    desc: "Женский, тёплый",
  },
];

// Gemini TTS голоса
const GEMINI_VOICES = [
  {
    id: "Puck",
    name: "Puck",
    lang: "multi",
    gender: "male",
    desc: "Мужской голос",
  },
  {
    id: "Charon",
    name: "Charon",
    lang: "multi",
    gender: "male",
    desc: "Мужской, глубокий",
  },
  {
    id: "Kore",
    name: "Kore",
    lang: "multi",
    gender: "female",
    desc: "Женский голос",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    lang: "multi",
    gender: "male",
    desc: "Мужской, энергичный",
  },
  {
    id: "Aoede",
    name: "Aoede",
    lang: "multi",
    gender: "female",
    desc: "Женский, мелодичный",
  },
];

// Объединённый список для обратной совместимости
const AVAILABLE_VOICES = EDGE_VOICES;

/**
 * GET /voices
 * Получить список всех конфигураций голосов
 */
router.get("/", async (req, res) => {
  try {
    const voices = await prisma.voiceConfig.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    res.json({
      success: true,
      voices,
      ttsProviders: TTS_PROVIDERS,
      availableVoices: {
        edge: EDGE_VOICES,
        openai: OPENAI_VOICES,
        gemini: GEMINI_VOICES,
      },
    });
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).json({ error: "Failed to fetch voices" });
  }
});

/**
 * GET /voices/available
 * Получить список доступных голосов Edge TTS
 */
router.get("/available", async (req, res) => {
  res.json({
    success: true,
    voices: AVAILABLE_VOICES,
  });
});

/**
 * GET /voices/default
 * Получить текущий голос по умолчанию
 */
router.get("/default", async (req, res) => {
  try {
    const defaultVoice = await prisma.voiceConfig.findFirst({
      where: { isDefault: true },
    });

    res.json({
      success: true,
      voice: defaultVoice,
    });
  } catch (error) {
    console.error("Error fetching default voice:", error);
    res.status(500).json({ error: "Failed to fetch default voice" });
  }
});

/**
 * POST /voices
 * Создать новую конфигурацию голоса
 */
router.post("/", async (req, res) => {
  const { name, ttsProvider, voice, rate, pitch, volume, isDefault } = req.body;

  if (!name || !voice) {
    return res.status(400).json({ error: "Name and voice are required" });
  }

  try {
    // Если этот голос будет основным, убираем флаг у остальных
    if (isDefault) {
      await prisma.voiceConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const voiceConfig = await prisma.voiceConfig.create({
      data: {
        name,
        ttsProvider: ttsProvider || "edge",
        voice,
        rate: rate || "+0%",
        pitch: pitch || "+0Hz",
        volume: volume || "+0%",
        isDefault: isDefault || false,
      },
    });

    res.json({
      success: true,
      voice: voiceConfig,
    });
  } catch (error) {
    console.error("Error creating voice:", error);
    res.status(500).json({ error: "Failed to create voice" });
  }
});

/**
 * PUT /voices/:id
 * Обновить конфигурацию голоса
 */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, ttsProvider, voice, rate, pitch, volume, isDefault } = req.body;

  try {
    // Если этот голос будет основным, убираем флаг у остальных
    if (isDefault) {
      await prisma.voiceConfig.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const voiceConfig = await prisma.voiceConfig.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(ttsProvider && { ttsProvider }),
        ...(voice && { voice }),
        ...(rate && { rate }),
        ...(pitch && { pitch }),
        ...(volume && { volume }),
        ...(typeof isDefault === "boolean" && { isDefault }),
      },
    });

    res.json({
      success: true,
      voice: voiceConfig,
    });
  } catch (error) {
    console.error("Error updating voice:", error);
    res.status(500).json({ error: "Failed to update voice" });
  }
});

/**
 * DELETE /voices/:id
 * Удалить конфигурацию голоса
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.voiceConfig.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Voice deleted",
    });
  } catch (error) {
    console.error("Error deleting voice:", error);
    res.status(500).json({ error: "Failed to delete voice" });
  }
});

/**
 * POST /voices/:id/set-default
 * Установить голос как основной
 */
router.post("/:id/set-default", async (req, res) => {
  const { id } = req.params;

  try {
    // Убираем флаг у всех
    await prisma.voiceConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // Устанавливаем новый основной
    const voiceConfig = await prisma.voiceConfig.update({
      where: { id },
      data: { isDefault: true },
    });

    res.json({
      success: true,
      voice: voiceConfig,
    });
  } catch (error) {
    console.error("Error setting default voice:", error);
    res.status(500).json({ error: "Failed to set default voice" });
  }
});

/**
 * POST /voices/preview
 * Генерирует превью аудио с заданными настройками
 */
router.post("/preview", async (req, res) => {
  const { text, ttsProvider, voice, rate, pitch, volume, speed, model } =
    req.body;

  if (!text || !voice) {
    return res.status(400).json({ error: "Text and voice are required" });
  }

  const provider = ttsProvider || "edge";

  // Проверяем доступность провайдера
  if (!isProviderAvailable(provider)) {
    return res.status(400).json({
      error: `TTS provider "${provider}" is not available. Check API key configuration.`,
    });
  }

  try {
    // Создаём директорию для превью
    await fs.mkdir(PREVIEW_DIR, { recursive: true });

    // Генерируем уникальное имя файла
    const filename = `preview_${Date.now()}.mp3`;
    const outputPath = path.join(PREVIEW_DIR, filename);

    console.log(`[Voice Preview] Provider: ${provider}, Voice: ${voice}`);

    // Используем универсальный TTS сервис
    await generateTTS(text, outputPath, {
      provider,
      voice,
      rate,
      pitch,
      volume,
      speed: speed || 1.0,
      model: model || "tts-1",
    });

    // Возвращаем URL превью
    res.json({
      success: true,
      url: `/storage/voice-previews/${filename}`,
    });

    // Удаляем старые превью (старше 1 часа)
    cleanupOldPreviews();
  } catch (error) {
    console.error("Error generating preview:", error);
    res
      .status(500)
      .json({ error: `Failed to generate preview: ${error.message}` });
  }
});

/**
 * Удаляет старые файлы превью
 */
async function cleanupOldPreviews() {
  try {
    const files = await fs.readdir(PREVIEW_DIR);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith("preview_")) continue;

      const filePath = path.join(PREVIEW_DIR, file);
      const stats = await fs.stat(filePath);

      if (now - stats.mtimeMs > oneHour) {
        await fs.unlink(filePath);
        console.log(`[Cleanup] Deleted old preview: ${file}`);
      }
    }
  } catch (error) {
    // Игнорируем ошибки очистки
  }
}

module.exports = router;
