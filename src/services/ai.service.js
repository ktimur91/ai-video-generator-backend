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
- Intro должно быть КОРОТКИМ ВВЕДЕНИЕМ В ТЕМУ: 5-15 слов
- Должно создавать атмосферу и погружать в тему ролика
- НЕ должно быть общим "Слушай это!" - а СВЯЗАННЫМ с темой!
- Примеры:
  - Тема "факты о Римской империи" → "Римская империя — величие, которое потрясло мир!"
  - Тема "интересное о космосе" → "Космос бесконечен, и вот что тебя удивит!"
  - Тема "лайфхаки для утра" → "Утро может быть продуктивным, слушай!"
- Добавь introKeywords для поиска видео фона ПО ТЕМЕ

=== OUTRO (ОЧЕНЬ ВАЖНО!) ===
- Outro должно быть В КОНТЕКСТЕ ТЕМЫ + призыв к действию
- Креативно вплети тему в призыв подписаться/лайкнуть
- Примеры:
  - Тема "Римская империя" → "Древние римляне бы точно подписались, а ты? Жми лайк и колокольчик!"
  - Тема "космос" → "Даже инопланетяне лайкают это видео! Подпишись и включи уведомления!"
  - Тема "коты" → "Мой кот уже подписан, а ты? Лайк, подписка, колокольчик!"
- ОБЯЗАТЕЛЬНО включи призывы: лайк, подписка, колокольчик
- Добавь outroKeywords для поиска видео фона ПО ТЕМЕ но с акцентом на призывы

Отвечай ТОЛЬКО в формате JSON:
{
  "title": "заголовок видео",
  "intro": "КОРОТКОЕ вступление (5-15 слов максимум!)",
  "introKeywords": ["energy", "dynamic", "action"],
  "segments": [
    {
      "number": 1,
      "text": "текст первого факта/совета (2-3 предложения)",
      "searchKeywords": ["keyword1", "keyword2", "keyword3"]
    }
  ],
  "outro": "ЭМОЦИОНАЛЬНЫЙ призыв с лайком, подпиской, колокольчиком и комментарием!",
  "outroKeywords": ["subscribe", "like button", "notification bell"],
  "tags": ["тег1", "тег2", "тег3", "тег4", "тег5"],
  "hashtags": ["#cats", "#коты", "#кошки", "#смешные"]
}

ВАЖНО для tags:
- Генерируй 8-15 тегов на РУССКОМ языке
- Теги должны быть релевантны контенту
- Включи популярные теги: shorts, факты, интересное, познавательное
- Теги помогают в поиске и рекомендациях YouTube

ВАЖНО для hashtags:
- Генерируй 3-4 тематических хештега для описания видео
- Хештеги должны быть релевантны теме видео
- Используй смесь русских и английских хештегов
- Примеры: если видео о котах → #cats #коты #кошки #смешные
- Примеры: если видео о космосе → #space #космос #вселенная #звезды

Ключевые слова для searchKeywords должны быть на АНГЛИЙСКОМ языке для поиска видео на стоках.`;

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
      tags: result.tags || ["shorts", "факты", "интересное"],
      hashtags: result.hashtags || ["#interesting", "#интересное"],
    };
  } catch (error) {
    console.error("Error generating script:", error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

module.exports = {
  generateScript,
};
