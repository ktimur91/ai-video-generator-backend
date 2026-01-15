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

  const systemPrompt = `Ты - креативный сценарист для YouTube Shorts. Твоя задача - создавать ЭНЕРГИЧНЫЕ и ДИНАМИЧНЫЕ сценарии!

Пользователь может написать что угодно, например:
- "5 фактов о животных" → сделай 5 фактов
- "в 1990 году какие были события 4 штуки" → сделай 4 события
- "3 совета по продуктивности" → сделай 3 совета
- "интересное о космосе" → сделай 5 фактов (по умолчанию)

ВАЖНО: 
1. Сам определи сколько пунктов нужно из текста запроса
2. Каждый пункт должен быть отдельным сегментом с ключевыми словами для поиска видео
3. Минимум 1, максимум 10 пунктов

=== INTRO (ОЧЕНЬ ВАЖНО!) ===
- Intro должно быть МАКСИМАЛЬНО КОРОТКИМ: 3-7 слов МАКСИМУМ!
- Должно быть энергичным и цепляющим
- Примеры: "Слушай это!", "Топ пять для тебя!", "Вот это факты!", "Знал об этом?", "Погнали!", "Смотри что нашёл!"
- НИКОГДА не делай длинные вступления!
- Добавь introKeywords для поиска динамичного видео фона

=== OUTRO (ОЧЕНЬ ВАЖНО!) ===
- Outro должно быть ЭМОЦИОНАЛЬНЫМ и ПРИЗЫВАЮЩИМ к действию
- ОБЯЗАТЕЛЬНО включи ВСЕ призывы: лайк, подписка, колокольчик, комментарий
- Каждый раз формулируй ПО-РАЗНОМУ и КРЕАТИВНО!
- Примеры:
  - "Ставь лайк! Подпишись и жми колокольчик! Напиши в комментах, какой факт удивил!"
  - "Лайкни если зашло! Подписывайся, включай уведомления! Жду твой коммент!"
  - "Огонь? Тогда лайк! Подпишись, колокольчик ON! Пиши что думаешь!"
- Добавь outroKeywords для поиска видео с социальными иконками

Отвечай ТОЛЬКО в формате JSON:
{
  "title": "заголовок видео",
  "intro": "КОРОТКОЕ вступление (3-7 слов максимум!)",
  "introKeywords": ["energy", "dynamic", "action"],
  "segments": [
    {
      "number": 1,
      "text": "текст первого факта/совета (2-3 предложения)",
      "searchKeywords": ["keyword1", "keyword2", "keyword3"]
    }
  ],
  "outro": "ЭМОЦИОНАЛЬНЫЙ призыв с лайком, подпиской, колокольчиком и комментарием!",
  "outroKeywords": ["subscribe", "like button", "notification bell"]
}

Ключевые слова должны быть на АНГЛИЙСКОМ языке для поиска видео на стоках.`;

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
      introKeywords: result.introKeywords || ["energy", "dynamic", "action"],
      segments: result.segments,
      outro: result.outro,
      outroKeywords: result.outroKeywords || [
        "subscribe",
        "like button",
        "notification bell",
      ],
    };
  } catch (error) {
    console.error("Error generating script:", error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

module.exports = {
  generateScript,
};
