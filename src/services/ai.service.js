const { chatJSON, DEFAULT_PROVIDER } = require("./ai-providers");

/**
 * Рассчитывает примерную длительность аудио по тексту
 * @param {string} text - Текст для озвучки
 * @param {number} charsPerSecond - Символов в секунду (по умолчанию 13 для среднего голоса)
 * @returns {number} - Примерная длительность в секундах
 */
function estimateDuration(text, charsPerSecond = 13) {
  if (!text) return 0;
  // Убираем лишние пробелы
  const cleanText = text.trim().replace(/\s+/g, " ");
  // Добавляем небольшой запас на паузы между предложениями
  const sentences = cleanText.split(/[.!?]+/).filter((s) => s.trim()).length;
  const pauseTime = sentences * 0.3; // 0.3 сек пауза между предложениями
  return Math.ceil(cleanText.length / charsPerSecond + pauseTime);
}

/**
 * Генерирует структурированный сценарий с фактами для YouTube Shorts
 * @param {string} topic - Тема для генерации сценария (например "5 фактов о животных", "в 1990 году какие были события 4 штуки")
 * @param {object} options - Опции генерации
 * @param {boolean} options.useLoopScript - Создать закольцованный сценарий (конец → начало)
 * @param {string} options.provider - AI провайдер (openai, gemini)
 * @param {string} options.model - Модель провайдера
 * @returns {Promise<{title: string, script: string, segments: Array}>}
 */
async function generateScript(topic, options = {}) {
  const { useLoopScript = false, provider, model } = options;

  // Используем переданный провайдер или дефолтный
  const useProvider = provider || DEFAULT_PROVIDER;
  const useModel = model || null;
  console.log(
    `[AI] Generating script for: "${topic}" (loop: ${useLoopScript}) with ${useProvider}`,
  );

  // Базовый промпт
  let systemPrompt = `Ты - креативный сценарист для YouTube Shorts. Твоя задача - создавать ЭНЕРГИЧНЫЕ и ДИНАМИЧНЫЕ сценарии!

Пользователь может написать что угодно, например:
- "5 фактов о животных" → сделай 5 фактов
- "в 1990 году какие были события 4 штуки" → сделай 4 события
- "3 совета по продуктивности" → сделай 3 совета
- "интересное о космосе" → сделай 5 фактов (по умолчанию)

ВАЖНО: 
1. Сам определи сколько пунктов нужно из текста запроса
2. Каждый пункт должен быть отдельным сегментом с ключевыми словами для поиска видео
3. Минимум 1, максимум 10 пунктов

=== ПРАВИЛО ПЕРВЫХ 3-Х СЕКУНД (КРИТИЧЕСКИ ВАЖНО!) ===
Пользователь скроллит ленту в состоянии транса. Твоя задача — СБИТЬ этот ритм!
- Intro должно МГНОВЕННО захватить внимание
- Используй СИЛЬНЫЕ ХУКИ:
  * Негативные: "Ты всю жизнь делал это неправильно..."
  * Срочность: "Никогда не делай этого в..."
  * Шок: "Учёные скрывали это 50 лет!"
  * Страх упустить: "99% людей не знают, что..."

ПЛОХИЕ хуки (НЕ ИСПОЛЬЗОВАТЬ):
- "Интересный факт о..."
- "А знали ли вы, что..."
- "Сегодня поговорим о..."

=== INTRO (ОЧЕНЬ ВАЖНО!) ===
- Intro должно быть СИЛЬНЫМ ХУКОМ: 5-15 слов
- Должно МГНОВЕННО захватить внимание с 0.1 секунды
- Примеры СИЛЬНЫХ хуков:
  - "Ты всю жизнь чистил зубы неправильно!"
  - "Никогда не делай этого в самолёте..."
  - "Этот факт скрывали от тебя всю жизнь!"
  - "Учёные до сих пор не могут объяснить..."
- Добавь introKeywords для поиска ДИНАМИЧНОГО видео с движением

=== OUTRO (ОЧЕНЬ ВАЖНО!) ===`;

  // Если включён loop-режим, добавляем инструкции для закольцовки
  if (useLoopScript) {
    systemPrompt += `
=== LOOP-РЕЖИМ АКТИВЕН (КРИТИЧЕСКИ ВАЖНО!) ===
Это ЗАКОЛЬЦОВАННОЕ видео! Зритель должен смотреть его бесконечно!

ГЛАВНОЕ ПРАВИЛО: Outro + Intro = ОДНО ПРЕДЛОЖЕНИЕ!
Когда видео перезапускается, outro должно БУКВАЛЬНО продолжаться в intro без паузы.

ЗАПРЕЩЕНО в LOOP-режиме:
❌ Призывы "подписывайтесь", "лайкайте", "комментируйте"
❌ Intro как полное законченное предложение
❌ Outro которое не связано с intro грамматически

ОБЯЗАТЕЛЬНО:
✅ Intro должно быть ПРОДОЛЖЕНИЕМ outro (как одно разорванное предложение)
✅ Outro заканчивается на незавершённой мысли
✅ При склейке outro→intro получается связный текст

ФОРМАТ:
- Intro: продолжение фразы (БЕЗ заглавной буквы, это середина предложения)
- Outro: начало фразы которая продолжится в intro

ПРИМЕРЫ ПРАВИЛЬНОГО LOOP (читай как одно предложение):
1) Outro: "Самое опасное существо на планете прямо сейчас находится" → Intro: "рядом с тобой, и ты даже не подозреваешь!"
2) Outro: "И если ты думаешь что это всё, то ты ещё не слышал про" → Intro: "самый шокирующий факт из всех!"
3) Outro: "Учёные до сих пор не могут объяснить почему" → Intro: "это происходит каждую ночь пока ты спишь!"

ПРОВЕРКА: Прочитай "Outro + Intro" вслух - должно звучать как ОДНО связное предложение!`;
  } else {
    systemPrompt += `
- Outro должно быть В КОНТЕКСТЕ ТЕМЫ + призыв к действию
- Креативно вплети тему в призыв подписаться/лайкнуть
- Примеры:
  - Тема "Римская империя" → "Древние римляне бы точно подписались, а ты? Жми лайк и колокольчик!"
  - Тема "космос" → "Даже инопланетяне лайкают это видео! Подпишись и включи уведомления!"
- ОБЯЗАТЕЛЬНО включи призывы: лайк, подписка, колокольчик`;
  }

  systemPrompt += `
- Добавь outroKeywords для поиска видео фона ПО ТЕМЕ

Отвечай ТОЛЬКО в формате JSON:
{
  "title": "заголовок видео",
  "intro": "${useLoopScript ? "ХУК который продолжает outro (5-15 слов)" : "СИЛЬНЫЙ ХУК (5-15 слов максимум!)"}",
  "introKeywords": ["dynamic action scene", "fast motion blur", "dramatic zoom camera"],
  "segments": [
    {
      "number": 1,
      "text": "текст первого факта/совета (2-3 предложения)",
      "searchKeywords": ["visual action phrase 1", "visual action phrase 2", "visual action phrase 3"]
    }
  ],
  "outro": "${useLoopScript ? "Фраза которая ПЕРЕТЕКАЕТ в intro" : "ЭМОЦИОНАЛЬНЫЙ призыв с лайком, подпиской, колокольчиком!"}",
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
Для intro ОБЯЗАТЕЛЬНО используй ключевые слова с ДВИЖЕНИЕМ (motion, action, dynamic, fast)!

ПЛОХИЕ примеры (абстрактные, не ищутся на стоках):
- "rome", "mythology", "gods", "history", "facts"
- "hades", "persephone", "zeus" (имена не дают результатов)

ХОРОШИЕ примеры (визуальные, находятся на стоках):
- "dark underground cave fire" - темная пещера с огнем
- "ancient marble statue temple" - античная статуя в храме  
- "mysterious fog forest night" - туманный лес ночью
- "golden throne room palace" - золотой тронный зал
- "stormy ocean waves dramatic" - штормовой океан с волнами
- "fast zoom explosion action" - для динамичного intro!

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
    console.log(
      `[AI] Using provider: ${useProvider}${useModel ? ` (${useModel})` : ""}`,
    );

    const { data: result } = await chatJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        provider: useProvider,
        model: useModel,
        temperature: 0.8,
        maxTokens: 3000,
      },
    );

    if (!result.title || !result.segments) {
      throw new Error("Invalid response format from AI");
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
 * @param {object} options - Опции
 * @param {string} options.provider - AI провайдер
 * @param {string} options.model - Модель
 * @returns {Promise<{topics: string[]}>}
 */
async function generateTopicSuggestions(category = null, options = {}) {
  const { provider, model } = options;
  const useProvider = provider || DEFAULT_PROVIDER;
  const useModel = model || null;

  console.log(
    `[AI] Generating topic suggestions for: "${category || "general"}" using ${useProvider}`,
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
    const { data: result } = await chatJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        provider: useProvider,
        model: useModel,
        temperature: 0.9,
        maxTokens: 1000,
      },
    );

    console.log(
      `[AI] Generated ${result.topics?.length || 0} topic suggestions`,
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
  estimateDuration,
};
