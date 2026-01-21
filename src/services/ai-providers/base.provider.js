/**
 * Базовый класс для AI провайдеров
 * Все провайдеры должны наследовать от этого класса
 */
class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Получить человекочитаемое имя провайдера
   * @returns {string}
   */
  getName() {
    return this.name;
  }

  /**
   * Проверить доступность провайдера (наличие API ключа)
   * @returns {boolean}
   */
  isAvailable() {
    throw new Error("Method isAvailable() must be implemented");
  }

  /**
   * Получить список доступных моделей
   * @returns {string[]}
   */
  getModels() {
    throw new Error("Method getModels() must be implemented");
  }

  /**
   * Получить модель по умолчанию
   * @returns {string}
   */
  getDefaultModel() {
    throw new Error("Method getDefaultModel() must be implemented");
  }

  /**
   * Выполнить chat completion
   * @param {Array} messages - Массив сообщений [{role: 'system'|'user'|'assistant', content: string}]
   * @param {object} options - Опции запроса
   * @param {string} options.model - Модель для использования
   * @param {number} options.temperature - Температура (0-1), по умолчанию 0.7
   * @param {number} options.maxTokens - Максимум токенов в ответе
   * @param {boolean} options.jsonMode - Режим JSON ответа
   * @returns {Promise<{content: string, usage: {promptTokens: number, completionTokens: number, totalTokens: number}}>}
   */
  async chat(messages, options = {}) {
    throw new Error("Method chat() must be implemented");
  }

  /**
   * Нормализовать сообщения в формат провайдера
   * @param {Array} messages - Сообщения в универсальном формате
   * @returns {Array} - Сообщения в формате провайдера
   */
  normalizeMessages(messages) {
    return messages;
  }

  /**
   * Логирование запроса
   */
  log(message, ...args) {
    console.log(`[${this.name}] ${message}`, ...args);
  }

  /**
   * Логирование ошибки
   */
  logError(message, error) {
    console.error(`[${this.name}] ${message}:`, error);
  }
}

module.exports = BaseProvider;
