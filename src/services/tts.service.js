/**
 * Unified TTS Service
 * Поддерживает: Edge TTS, OpenAI TTS, Gemini TTS
 */

const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const OpenAI = require("openai");

// Путь к edge-tts CLI
const EDGE_TTS_PATH = process.env.EDGE_TTS_PATH || "edge-tts";

// Путь к ffmpeg (для конвертации Gemini TTS)
const FFMPEG_PATH = process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";

// OpenAI клиент
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Gemini клиент
let geminiClient = null;
if (process.env.GEMINI_API_KEY) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Генерация аудио через Edge TTS
 */
async function generateEdgeTTS(text, outputPath, options = {}) {
  const {
    voice = "ru-RU-DmitryNeural",
    rate = "+0%",
    pitch = "+0Hz",
    volume = "+0%",
  } = options;

  const rateParam = rate ? `--rate="${rate}"` : "";
  const pitchParam = pitch ? `--pitch="${pitch}"` : "";
  const volumeParam = volume && volume !== "+0%" ? `--volume="${volume}"` : "";

  // Создаём временный файл с текстом
  const textFilePath = outputPath.replace(".mp3", ".txt");
  await fs.writeFile(textFilePath, text, "utf-8");

  const command = `"${EDGE_TTS_PATH}" --voice "${voice}" ${rateParam} ${pitchParam} ${volumeParam} --file "${textFilePath}" --write-media "${outputPath}"`;

  console.log("[Edge TTS] Command:", command);

  return new Promise((resolve, reject) => {
    exec(
      command,
      { maxBuffer: 1024 * 1024 * 10 },
      async (error, stdout, stderr) => {
        // Удаляем временный файл
        try {
          await fs.unlink(textFilePath);
        } catch (e) {}

        if (error) {
          console.error("[Edge TTS] Error:", error);
          reject(new Error(`Edge TTS failed: ${error.message}`));
          return;
        }

        console.log("[Edge TTS] Audio generated:", outputPath);
        resolve(outputPath);
      },
    );
  });
}

/**
 * Генерация аудио через OpenAI TTS
 * Модели: tts-1 (быстрая), tts-1-hd (качество)
 * Голоса: alloy, echo, fable, onyx, nova, shimmer
 */
async function generateOpenAITTS(text, outputPath, options = {}) {
  const { voice = "alloy", model = "tts-1", speed = 1.0 } = options;

  if (!openaiClient) {
    throw new Error("OpenAI API key not configured");
  }

  console.log(`[OpenAI TTS] Generating with voice: ${voice}, model: ${model}`);

  const response = await openaiClient.audio.speech.create({
    model: model,
    voice: voice,
    input: text,
    speed: speed,
  });

  // Получаем буфер и сохраняем
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, buffer);

  console.log("[OpenAI TTS] Audio generated:", outputPath);
  return outputPath;
}

/**
 * Генерация аудио через Gemini TTS
 * Модель: gemini-2.5-flash-preview-tts
 * Голоса: Puck, Charon, Kore, Fenrir, Aoede
 *
 * ВАЖНО: Gemini возвращает аудио в формате audio/L16 (PCM 16-bit linear)
 * Sample rate: 24000 Hz, mono, 16-bit
 */
async function generateGeminiTTS(text, outputPath, options = {}) {
  const { voice = "Puck" } = options;

  if (!geminiClient) {
    throw new Error("Gemini API key not configured");
  }

  console.log(
    `[Gemini TTS] Generating with voice: ${voice}, text: "${text.substring(0, 50)}..."`,
  );

  try {
    const model = geminiClient.getGenerativeModel({
      model: "gemini-2.5-flash-preview-tts",
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voice,
            },
          },
        },
      },
    });

    const response = result.response;
    console.log("[Gemini TTS] Response received");

    // Получаем аудио данные из ответа
    if (response.candidates && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType;
          console.log(`[Gemini TTS] Audio mimeType: ${mimeType}`);

          const audioData = Buffer.from(part.inlineData.data, "base64");
          console.log(
            `[Gemini TTS] Audio data size: ${audioData.length} bytes`,
          );
          console.log(
            `[Gemini TTS] First 16 bytes: ${audioData.slice(0, 16).toString("hex")}`,
          );

          // Gemini TTS всегда возвращает raw PCM (audio/L16) @ 24kHz mono 16-bit
          // Нужно всегда добавлять WAV header и конвертировать в MP3
          const wavPath = outputPath.replace(".mp3", ".wav");

          // Добавляем WAV header к PCM данным
          // Gemini использует 24000 Hz, 1 channel, 16-bit
          const wavBuffer = addWavHeader(audioData, 24000, 1, 16);
          await fs.writeFile(wavPath, wavBuffer);
          console.log(
            `[Gemini TTS] WAV file saved: ${wavPath}, size: ${wavBuffer.length} bytes`,
          );

          // Конвертируем в MP3 через ffmpeg
          await convertToMp3(wavPath, outputPath);

          // Удаляем временный WAV
          try {
            await fs.unlink(wavPath);
          } catch (e) {}

          console.log("[Gemini TTS] Audio converted to MP3:", outputPath);
          return outputPath;
        }
      }
    }

    console.log(
      "[Gemini TTS] Full response:",
      JSON.stringify(response, null, 2),
    );
    throw new Error("No audio data in Gemini response");
  } catch (error) {
    console.error("[Gemini TTS] Error:", error);
    throw new Error(`Gemini TTS failed: ${error.message}`);
  }
}

/**
 * Добавляет WAV header к сырым PCM данным
 */
function addWavHeader(
  pcmData,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
) {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize - 8;

  const header = Buffer.alloc(headerSize);

  // RIFF header
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);

  // fmt subchunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM = 1)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/**
 * Конвертирует аудио файл в MP3 через ffmpeg
 */
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const command = `"${FFMPEG_PATH}" -y -i "${inputPath}" -codec:a libmp3lame -qscale:a 2 "${outputPath}"`;
    console.log("[FFmpeg] Converting:", command);

    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error("[FFmpeg] Error:", error);
        reject(new Error(`FFmpeg conversion failed: ${error.message}`));
        return;
      }
      resolve(outputPath);
    });
  });
}

/**
 * Универсальная функция генерации TTS
 * @param {string} text - Текст для озвучивания
 * @param {string} outputPath - Путь для сохранения аудио
 * @param {object} options - Настройки
 * @param {string} options.provider - TTS провайдер: edge, openai, gemini
 * @param {string} options.voice - ID голоса
 * @param {string} options.rate - Скорость (для Edge TTS)
 * @param {string} options.pitch - Высота (для Edge TTS)
 * @param {string} options.volume - Громкость (для Edge TTS)
 * @param {number} options.speed - Скорость 0.25-4.0 (для OpenAI TTS)
 * @param {string} options.model - Модель TTS (для OpenAI: tts-1, tts-1-hd)
 */
async function generateTTS(text, outputPath, options = {}) {
  const provider = options.provider || options.ttsProvider || "edge";

  console.log(`[TTS] Using provider: ${provider}`);

  switch (provider) {
    case "openai":
      return generateOpenAITTS(text, outputPath, options);
    case "gemini":
      return generateGeminiTTS(text, outputPath, options);
    case "edge":
    default:
      return generateEdgeTTS(text, outputPath, options);
  }
}

/**
 * Проверить доступность TTS провайдера
 */
function isProviderAvailable(provider) {
  switch (provider) {
    case "openai":
      return !!openaiClient;
    case "gemini":
      return !!geminiClient;
    case "edge":
      return true; // Edge TTS всегда доступен (если установлен)
    default:
      return false;
  }
}

module.exports = {
  generateTTS,
  generateEdgeTTS,
  generateOpenAITTS,
  generateGeminiTTS,
  isProviderAvailable,
};
