const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;

const prisma = new PrismaClient();

// Путь к edge-tts CLI
const EDGE_TTS_PATH = "/Users/apple/Library/Python/3.9/bin/edge-tts";
const PREVIEW_DIR = path.join(__dirname, "../../storage/voice-previews");

// Доступные голоса Edge TTS (русские и популярные английские)
const AVAILABLE_VOICES = [
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
      availableVoices: AVAILABLE_VOICES,
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
  const { name, voice, rate, pitch, volume, isDefault } = req.body;

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
  const { name, voice, rate, pitch, volume, isDefault } = req.body;

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
  const { text, voice, rate, pitch, volume } = req.body;

  if (!text || !voice) {
    return res.status(400).json({ error: "Text and voice are required" });
  }

  try {
    // Создаём директорию для превью
    await fs.mkdir(PREVIEW_DIR, { recursive: true });

    // Генерируем уникальное имя файла
    const filename = `preview_${Date.now()}.mp3`;
    const outputPath = path.join(PREVIEW_DIR, filename);

    // Формируем команду edge-tts
    const rateParam = rate ? `--rate="${rate}"` : "";
    const pitchParam = pitch ? `--pitch="${pitch}"` : "";
    const volumeParam = volume ? `--volume="${volume}"` : "";

    const command = `"${EDGE_TTS_PATH}" --voice "${voice}" ${rateParam} ${pitchParam} ${volumeParam} --text "${text.replace(
      /"/g,
      '\\"'
    )}" --write-media "${outputPath}"`;

    console.log("[Voice Preview] Command:", command);

    await new Promise((resolve, reject) => {
      exec(
        command,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (error) {
            console.error("[Voice Preview] Error:", error);
            console.error("[Voice Preview] Stderr:", stderr);
            reject(error);
            return;
          }
          resolve();
        }
      );
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
    res.status(500).json({ error: "Failed to generate preview" });
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
