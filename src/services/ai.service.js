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
  "introKeywords": ["epic cinematic sky", "golden light clouds", "dramatic sunset horizon"],
  "segments": [
    {
      "number": 1,
      "text": "текст первого факта/совета (2-3 предложения)",
      "searchKeywords": ["visual action phrase 1", "visual action phrase 2", "visual action phrase 3"]
    }
  ],
  "outro": "ЭМОЦИОНАЛЬНЫЙ призыв с лайком, подпиской, колокольчиком и комментарием!",
  "outroKeywords": ["phone notification glow", "hand pressing like", "bell ringing animation"],
  "tags": ["тег1", "тег2", "тег3", "тег4", "тег5"],
  "hashtags": ["#cats", "#коты", "#кошки", "#смешные"],
  "music": {
    "mood": "epic",
    "tempo": "medium",
    "keywords": ["cinematic", "orchestral", "dramatic"]
  }
}

=== ВАЖНО для music ===
Подбери фоновую музыку для видео:

mood - настроение музыки (одно из):
- "epic" - эпичная, кинематографичная (для мифологии, истории, фактов)
- "calm" - спокойная, умиротворяющая (для природы, медитации)
- "energetic" - энергичная (для спорта, мотивации, лайфхаков)
- "dark" - темная, напряженная (для хоррора, криминала, тайн)
- "happy" - веселая, позитивная (для юмора, животных)
- "inspiring" - вдохновляющая (для мотивации, успеха)
- "mysterious" - загадочная (для науки, космоса, тайн)

tempo - темп музыки:
- "slow" - медленный (для спокойных тем)
- "medium" - средний (универсальный)
- "fast" - быстрый (для энергичных тем)

keywords - 2-4 ключевых слова для поиска музыки на АНГЛИЙСКОМ:
- Примеры для мифологии: ["epic", "orchestral", "cinematic", "ancient"]
- Примеры для науки: ["electronic", "ambient", "futuristic"]
- Примеры для юмора: ["fun", "quirky", "playful"]

=== КРИТИЧЕСКИ ВАЖНО для searchKeywords, introKeywords, outroKeywords ===
Ключевые слова должны описывать ВИЗУАЛЬНОЕ ДЕЙСТВИЕ или АТМОСФЕРУ, а НЕ абстрактные понятия!

ПЛОХИЕ примеры (абстрактные, не ищутся на стоках):
- "rome", "mythology", "gods", "history", "facts"
- "hades", "persephone", "zeus" (имена не дают результатов)

ХОРОШИЕ примеры (визуальные, находятся на стоках):
- "dark underground cave fire" - темная пещера с огнем
- "ancient marble statue temple" - античная статуя в храме  
- "mysterious fog forest night" - туманный лес ночью
- "golden throne room palace" - золотой тронный зал
- "stormy ocean waves dramatic" - штормовой океан с волнами

Для каждого сегмента генерируй 3 РАЗНЫХ визуальных фразы из 2-4 слов.
Фразы должны быть УНИКАЛЬНЫМИ для каждого сегмента чтобы видео фоны не повторялись!

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

/**
 * Генерирует список тем для YouTube Shorts
 * @param {string} category - Категория или тема для генерации идей (опционально)
 * @returns {Promise<{topics: string[]}>}
 */
async function generateTopicSuggestions(category = null) {
  console.log(
    `[AI] Generating topic suggestions for: "${category || "general"}"`
  );

  const systemPrompt = `Ты - креативный маркетолог YouTube Shorts. Твоя задача - предлагать ВИРУСНЫЕ и ИНТЕРЕСНЫЕ темы для коротких видео.

Генерируй темы которые:
- Цепляют внимание с первых секунд
- Вызывают любопытство
- Подходят для формата до 60 секунд
- Могут стать вирусными

Формат ответа - JSON:
{
  "topics": [
    "5 фактов о космосе, которые взорвут мозг",
    "Почему ты неправильно чистишь зубы",
    "3 секрета миллионеров о которых не говорят",
    "Что произойдет если не спать 3 дня",
    "Топ 5 самых опасных животных в мире"
  ]
}

Генерируй 8-12 разнообразных тем. Темы должны быть на РУССКОМ языке.`;

  const userPrompt = category
    ? `Дай мне список тем для YouTube Shorts на тему: "${category}". Предложи 8-12 креативных и интересных идей.`
    : `Дай мне список разнообразных тем для YouTube Shorts. Предложи 8-12 интересных и вирусных идей из разных сфер: наука, психология, факты, лайфхаки, интересное.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    console.log(
      `[AI] Generated ${result.topics?.length || 0} topic suggestions`
    );

    return {
      topics: result.topics || [],
    };
  } catch (error) {
    console.error("Error generating topic suggestions:", error);
    throw new Error(`Failed to generate topics: ${error.message}`);
  }
}

module.exports = {
  generateScript,
  generateTopicSuggestions,
};
