/**
 * OpenAI Provider
 * Поддерживает широкий спектр моделей для разных задач
 */

const OpenAI = require("openai");
const BaseProvider = require("./base.provider");

class OpenAIProvider extends BaseProvider {
  constructor() {
    super("OpenAI");

    this.apiKey = process.env.OPENAI_API_KEY;
    this.client = this.apiKey ? new OpenAI({ apiKey: this.apiKey }) : null;

    // Модели для чата/генерации текста (используем в приложении)
    this.models = [
      "gpt-4o-mini", // 💬 Чат: быстрый и дешёвый
      "gpt-4o", // 💬 Чат: мощный мультимодальный (текст + изображения)
      "gpt-4.1", // 💬 Чат: улучшенная версия GPT-4
      "gpt-4.1-mini", // 💬 Чат: быстрая версия GPT-4.1
      "gpt-5", // 💬 Чат: новейший флагман
      "gpt-5-mini", // 💬 Чат: быстрая версия GPT-5
      "o3-mini", // 🧠 Reasoning: логическое мышление
      "o4-mini", // 🧠 Reasoning: улучшенное мышление
    ];

    // Все доступные модели с описаниями
    this.allModels = {
      // === ЧАТ / ТЕКСТ ===
      "gpt-4o-mini": { type: "chat", desc: "Быстрый и дешёвый" },
      "gpt-4o": { type: "chat", desc: "Мощный мультимодальный" },
      "gpt-4.1": { type: "chat", desc: "Улучшенный GPT-4" },
      "gpt-4.1-mini": { type: "chat", desc: "Быстрый GPT-4.1" },
      "gpt-5": { type: "chat", desc: "Новейший флагман" },
      "gpt-5-mini": { type: "chat", desc: "Быстрый GPT-5" },
      "gpt-5-pro": { type: "chat", desc: "Максимальная мощность" },

      // === REASONING (логика) ===
      o1: { type: "reasoning", desc: "Глубокое мышление" },
      "o1-pro": { type: "reasoning", desc: "Про версия o1" },
      o3: { type: "reasoning", desc: "Новое поколение reasoning" },
      "o3-mini": { type: "reasoning", desc: "Быстрый reasoning" },
      "o4-mini": { type: "reasoning", desc: "Улучшенный reasoning" },

      // === ИЗОБРАЖЕНИЯ ===
      "dall-e-3": { type: "image", desc: "Генерация изображений" },
      "dall-e-2": { type: "image", desc: "Генерация изображений (старая)" },
      "gpt-image-1": { type: "image", desc: "Новая генерация изображений" },

      // === ВИДЕО ===
      "sora-2": { type: "video", desc: "Генерация видео" },
      "sora-2-pro": { type: "video", desc: "Генерация видео (про)" },

      // === АУДИО / TTS ===
      "tts-1": { type: "tts", desc: "Озвучка текста" },
      "tts-1-hd": { type: "tts", desc: "Озвучка HD качество" },
      "gpt-4o-mini-tts": { type: "tts", desc: "TTS на базе GPT-4o" },
      "whisper-1": { type: "stt", desc: "Распознавание речи" },
      "gpt-4o-transcribe": { type: "stt", desc: "Транскрипция" },

      // === EMBEDDINGS ===
      "text-embedding-3-large": {
        type: "embedding",
        desc: "Векторные представления",
      },
      "text-embedding-3-small": {
        type: "embedding",
        desc: "Быстрые embeddings",
      },
    };

    this.defaultModel = "gpt-4o-mini";
  }

  isAvailable() {
    return !!this.apiKey && !!this.client;
  }

  getModels() {
    return this.models;
  }

  getDefaultModel() {
    return this.defaultModel;
  }

  async chat(messages, options = {}) {
    if (!this.isAvailable()) {
      throw new Error(
        "OpenAI API key not configured. Set OPENAI_API_KEY environment variable.",
      );
    }

    const model = options.model || this.defaultModel;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens || 2000;
    const jsonMode = options.jsonMode || false;

    this.log(
      `Chat request: model=${model}, messages=${messages.length}, jsonMode=${jsonMode}`,
    );

    try {
      const requestParams = {
        model,
        messages: this.normalizeMessages(messages),
        temperature,
        max_tokens: maxTokens,
      };

      // JSON mode
      if (jsonMode) {
        requestParams.response_format = { type: "json_object" };
      }

      const response = await this.client.chat.completions.create(requestParams);

      const content = response.choices[0]?.message?.content || "";
      const usage = {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      this.log(
        `Response: ${content.length} chars, ${usage.totalTokens} tokens`,
      );

      return { content, usage };
    } catch (error) {
      this.logError("Chat error", error);
      throw new Error(`OpenAI error: ${error.message}`);
    }
  }

  normalizeMessages(messages) {
    // OpenAI уже использует стандартный формат
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
}

module.exports = OpenAIProvider;
