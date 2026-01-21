/**
 * Google Gemini Provider
 * Поддерживает: Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 1.5 Flash
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const BaseProvider = require("./base.provider");

class GeminiProvider extends BaseProvider {
  constructor() {
    super("Gemini");

    this.apiKey = process.env.GEMINI_API_KEY;
    this.client = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;

    // Модели для чата/генерации текста (используем в приложении)
    this.models = [
      "gemini-2.0-flash", // 💬 Чат: быстрый и стабильный
      "gemini-2.5-flash", // 💬 Чат: новейший быстрый
      "gemini-2.5-pro", // 💬 Чат: максимальная мощность
      "gemini-2.0-flash-lite", // 💬 Чат: ультра-быстрый
    ];

    // Все доступные модели с описаниями
    this.allModels = {
      // === ЧАТ / ТЕКСТ ===
      "gemini-2.0-flash": { type: "chat", desc: "Быстрый и стабильный" },
      "gemini-2.0-flash-lite": { type: "chat", desc: "Ультра-быстрый" },
      "gemini-2.5-flash": { type: "chat", desc: "Новейший быстрый" },
      "gemini-2.5-flash-lite": { type: "chat", desc: "Легкий 2.5" },
      "gemini-2.5-pro": { type: "chat", desc: "Максимальная мощность" },
      "gemini-3-flash-preview": { type: "chat", desc: "Gemini 3 Preview" },
      "gemini-3-pro-preview": { type: "chat", desc: "Gemini 3 Pro Preview" },

      // === ИЗОБРАЖЕНИЯ ===
      "gemini-2.0-flash-exp-image-generation": {
        type: "image",
        desc: "Генерация изображений",
      },
      "gemini-2.5-flash-image": { type: "image", desc: "Создание изображений" },
      "imagen-4.0-generate-001": { type: "image", desc: "Imagen 4" },
      "imagen-4.0-ultra-generate-001": {
        type: "image",
        desc: "Imagen 4 Ultra",
      },
      "imagen-4.0-fast-generate-001": { type: "image", desc: "Imagen 4 Fast" },

      // === ВИДЕО ===
      "veo-2.0-generate-001": {
        type: "video",
        desc: "Veo 2 - генерация видео",
      },
      "veo-3.0-generate-001": {
        type: "video",
        desc: "Veo 3 - генерация видео",
      },
      "veo-3.0-fast-generate-001": { type: "video", desc: "Veo 3 Fast" },
      "veo-3.1-generate-preview": { type: "video", desc: "Veo 3.1 Preview" },

      // === TTS (озвучка) ===
      "gemini-2.5-flash-preview-tts": { type: "tts", desc: "Озвучка текста" },
      "gemini-2.5-pro-preview-tts": { type: "tts", desc: "Озвучка Pro" },

      // === EMBEDDINGS ===
      "gemini-embedding-001": {
        type: "embedding",
        desc: "Векторные представления",
      },
      "text-embedding-004": { type: "embedding", desc: "Text Embeddings" },

      // === СПЕЦИАЛЬНЫЕ ===
      "gemini-2.5-computer-use-preview-10-2025": {
        type: "agent",
        desc: "Управление компьютером",
      },
      "deep-research-pro-preview-12-2025": {
        type: "research",
        desc: "Глубокий research",
      },
    };

    this.defaultModel = "gemini-2.0-flash";
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
        "Gemini API key not configured. Set GEMINI_API_KEY environment variable.",
      );
    }

    const modelName = options.model || this.defaultModel;
    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens || 2000;
    const jsonMode = options.jsonMode || false;

    this.log(
      `Chat request: model=${modelName}, messages=${messages.length}, jsonMode=${jsonMode}`,
    );

    try {
      // Настройка генерации
      const generationConfig = {
        temperature,
        maxOutputTokens: maxTokens,
      };

      // JSON mode через MIME type
      if (jsonMode) {
        generationConfig.responseMimeType = "application/json";
      }

      // Конвертируем сообщения в формат Gemini
      const { systemInstruction, history, userMessage } =
        this.convertMessages(messages);

      // Настройки модели
      const modelConfig = {
        model: modelName,
        generationConfig,
      };

      // systemInstruction передаётся в getGenerativeModel как строка
      if (systemInstruction) {
        modelConfig.systemInstruction = systemInstruction;
      }

      const model = this.client.getGenerativeModel(modelConfig);

      // Создаём чат с историей
      const chat = model.startChat({
        history,
      });

      // Отправляем последнее сообщение
      const result = await chat.sendMessage(userMessage);
      const response = await result.response;
      const content = response.text();

      // Gemini не возвращает точное количество токенов в ответе
      // Примерный расчёт: 1 токен ≈ 4 символа
      const usage = {
        promptTokens: Math.ceil(
          messages.reduce((acc, m) => acc + m.content.length, 0) / 4,
        ),
        completionTokens: Math.ceil(content.length / 4),
        totalTokens: 0,
      };
      usage.totalTokens = usage.promptTokens + usage.completionTokens;

      this.log(
        `Response: ${content.length} chars, ~${usage.totalTokens} tokens`,
      );

      return { content, usage };
    } catch (error) {
      this.logError("Chat error", error);
      throw new Error(`Gemini error: ${error.message}`);
    }
  }

  /**
   * Конвертирует универсальный формат сообщений в формат Gemini
   * Gemini использует отдельный systemInstruction и историю чата
   */
  convertMessages(messages) {
    let systemInstruction = null;
    const history = [];
    let userMessage = "";

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === "system") {
        // System сообщение идёт отдельно
        systemInstruction = msg.content;
      } else if (i === messages.length - 1 && msg.role === "user") {
        // Последнее user сообщение отправляется отдельно
        userMessage = msg.content;
      } else {
        // Остальные идут в историю
        history.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    return { systemInstruction, history, userMessage };
  }
}

module.exports = GeminiProvider;
