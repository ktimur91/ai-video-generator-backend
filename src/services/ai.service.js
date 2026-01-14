const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Генерирует структурированный сценарий с фактами для YouTube Shorts
 * @param {string} topic - Тема для генерации сценария (например "5 фактов о животных", "в 1990 году какие были события 4 штуки")
 * @returns {Promise<{title: string, script: string, segments: Array}>}
 */
async function generateScript(topic) {
  console.log(`[AI] Generating script for: "${topic}"`);

  const systemPrompt = `Ты - креативный сценарист для YouTube Shorts.
Твоя задача - понять запрос пользователя и создать сценарий с нужным количеством фактов/событий/советов.

Пользователь может написать что угодно, например:
- "5 фактов о животных" → сделай 5 фактов
- "в 1990 году какие были события 4 штуки" → сделай 4 события
- "3 совета по продуктивности" → сделай 3 совета
- "интересное о космосе" → сделай 5 фактов (по умолчанию)

ВАЖНО: 
1. Сам определи сколько пунктов нужно из текста запроса
2. Каждый пункт должен быть отдельным сегментом с ключевыми словами для поиска видео
3. Минимум 1, максимум 10 пунктов

Отвечай ТОЛЬКО в формате JSON:
{
  "title": "заголовок видео",
  "intro": "короткое вступление (1-2 предложения)",
  "segments": [
    {
      "number": 1,
      "text": "текст первого факта/совета (2-3 предложения)",
      "searchKeywords": ["keyword1", "keyword2", "keyword3"]
    }
  ],
  "outro": "призыв к действию (1 предложение)"
}

Ключевые слова searchKeywords должны быть на АНГЛИЙСКОМ языке для поиска видео на стоках.
Например, для факта про слонов: ["elephant", "african elephant", "elephant walking"]`;

  const userPrompt = topic;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    if (!result.title || !result.segments) {
      throw new Error("Invalid response format from OpenAI");
    }

    console.log(`[AI] Generated ${result.segments.length} segments`);

    // Собираем полный script для обратной совместимости
    const fullScript = [
      result.intro,
      ...result.segments.map((s) => `${s.number}. ${s.text}`),
      result.outro,
    ].join("\n\n");

    return {
      title: result.title,
      script: fullScript,
      intro: result.intro,
      segments: result.segments,
      outro: result.outro,
    };
  } catch (error) {
    console.error("Error generating script:", error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

module.exports = {
  generateScript,
};
