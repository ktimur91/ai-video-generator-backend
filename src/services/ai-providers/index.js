/**
 * AI Providers - Унифицированная система для работы с разными AI провайдерами
 *
 * Поддерживаемые провайдеры:
 * - openai (GPT-4o-mini, GPT-4o, GPT-4)
 * - gemini (Gemini Pro, Gemini Flash)
 *
 * Использование:
 * const { getProvider, chat } = require('./ai-providers');
 *
 * // Получить провайдер напрямую
 * const provider = getProvider('gemini');
 * const response = await provider.chat(messages, options);
 *
 * // Или использовать хелпер
 * const response = await chat(messages, { provider: 'openai', model: 'gpt-4o-mini' });
 */

const OpenAIProvider = require("./openai.provider");
const GeminiProvider = require("./gemini.provider");

// Реестр провайдеров
const providers = {
  openai: new OpenAIProvider(),
  gemini: new GeminiProvider(),
};

// Провайдер по умолчанию
const DEFAULT_PROVIDER = process.env.DEFAULT_AI_PROVIDER || "openai";

/**
 * Получить провайдер по имени
 * @param {string} name - Имя провайдера (openai, gemini)
 * @returns {BaseProvider}
 */
function getProvider(name = DEFAULT_PROVIDER) {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `Unknown AI provider: ${name}. Available: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}

/**
 * Проверить доступность провайдера
 * @param {string} name - Имя провайдера
 * @returns {boolean}
 */
function isProviderAvailable(name) {
  const provider = providers[name];
  return provider ? provider.isAvailable() : false;
}

/**
 * Получить список доступных провайдеров
 * @returns {Array<{id: string, name: string, available: boolean, models: string[]}>}
 */
function getAvailableProviders() {
  return Object.entries(providers).map(([id, provider]) => ({
    id,
    name: provider.getName ? provider.getName() : id,
    available: provider.isAvailable(),
    models: provider.getModels(),
    defaultModel: provider.getDefaultModel(),
  }));
}

/**
 * Универсальный метод для chat completion
 * @param {Array} messages - Массив сообщений [{role: 'user', content: '...'}, ...]
 * @param {object} options - Опции
 * @param {string} options.provider - Провайдер (openai, gemini)
 * @param {string} options.model - Модель
 * @param {number} options.temperature - Температура (0-1)
 * @param {number} options.maxTokens - Максимум токенов
 * @param {boolean} options.jsonMode - Режим JSON ответа
 * @returns {Promise<{content: string, usage: object}>}
 */
async function chat(messages, options = {}) {
  const providerName = options.provider || DEFAULT_PROVIDER;
  const provider = getProvider(providerName);
  return provider.chat(messages, options);
}

/**
 * Универсальный метод для chat completion с JSON ответом
 * @param {Array} messages - Массив сообщений
 * @param {object} options - Опции (см. chat)
 * @returns {Promise<{data: object, usage: object}>}
 */
async function chatJSON(messages, options = {}) {
  const result = await chat(messages, { ...options, jsonMode: true });
  try {
    const data = JSON.parse(result.content);
    return { data, usage: result.usage };
  } catch (error) {
    throw new Error(
      `Failed to parse JSON response: ${error.message}. Content: ${result.content}`,
    );
  }
}

module.exports = {
  getProvider,
  isProviderAvailable,
  getAvailableProviders,
  chat,
  chatJSON,
  DEFAULT_PROVIDER,
  providers,
};
