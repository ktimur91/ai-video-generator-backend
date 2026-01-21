/**
 * API маршруты для управления AI провайдерами
 */

const express = require("express");
const router = express.Router();

const {
  getAvailableProviders,
  isProviderAvailable,
  DEFAULT_PROVIDER,
} = require("../services/ai-providers");

/**
 * GET /api/ai-providers
 * Получить список доступных AI провайдеров
 */
router.get("/", (req, res) => {
  try {
    const providers = getAvailableProviders();

    res.json({
      success: true,
      providers,
      defaultProvider: DEFAULT_PROVIDER,
    });
  } catch (error) {
    console.error("[AI Providers] Error getting providers:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ai-providers/check
 * Проверить доступность конкретного провайдера
 *
 * Body: {
 *   provider: "openai" | "gemini",
 * }
 */
router.post("/check", (req, res) => {
  try {
    const { provider } = req.body;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: "Provider is required",
      });
    }

    const available = isProviderAvailable(provider);

    res.json({
      success: true,
      provider,
      available,
    });
  } catch (error) {
    console.error("[AI Providers] Error checking provider:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/ai-providers/test
 * Тест провайдера - простой запрос для проверки работоспособности
 *
 * Body: {
 *   provider: "openai" | "gemini",
 *   model?: string
 * }
 */
router.post("/test", async (req, res) => {
  try {
    const { provider, model } = req.body;

    if (!provider) {
      return res.status(400).json({
        success: false,
        error: "Provider is required",
      });
    }

    const { chat } = require("../services/ai-providers");

    const startTime = Date.now();

    const { content, usage } = await chat(
      [{ role: "user", content: "Ответь одним словом: Привет!" }],
      {
        provider,
        model,
        maxTokens: 50,
        temperature: 0.5,
      },
    );

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      provider,
      model: model || "default",
      response: content,
      duration: `${duration}ms`,
      usage,
    });
  } catch (error) {
    console.error("[AI Providers] Test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
