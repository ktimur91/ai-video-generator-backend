const { chat, chatJSON, DEFAULT_PROVIDER } = require("./ai-providers");

/**
 * AI помощник для редактирования видео
 * Работает на двух уровнях:
 * 1. Уровень сегмента - редактирование текста, поиск видео
 * 2. Уровень видео - массовые изменения (тексты, фоны, музыка)
 */

/**
 * Обрабатывает запрос на уровне сегмента
 * @param {string} userMessage - Сообщение пользователя
 * @param {Array} chatHistory - История чата
 * @param {object} context - Контекст сегмента
 * @param {string} context.segmentText - Текущий текст сегмента
 * @param {string} context.segmentType - Тип сегмента (intro, fact, outro)
 * @param {number} context.segmentIndex - Индекс сегмента
 * @param {Array} context.currentVideos - Текущие видео сегмента
 * @param {boolean} context.useLoopScript - Это loop-видео (закольцованное)
 * @param {string} context.introText - Текст intro (для контекста loop)
 * @param {string} context.outroText - Текст outro (для контекста loop)
 * @param {string} context.aiProvider - AI провайдер (openai, gemini)
 * @param {string} context.aiModel - AI модель
 * @returns {Promise<{message: string, actions: Array}>}
 */
async function processSegmentRequest(
  userMessage,
  chatHistory = [],
  context = {},
) {
  const provider = context.aiProvider || DEFAULT_PROVIDER;
  const model = context.aiModel || null;

  console.log(
    `[AI Assistant] Processing segment request with ${provider}:`,
    userMessage,
  );

  // Добавляем информацию о loop-режиме
  const loopInfo = context.useLoopScript
    ? `
=== 🔄 LOOP-РЕЖИМ АКТИВЕН — ЭТО САМОЕ ВАЖНОЕ! ===

ТЕКУЩИЕ ТЕКСТЫ:
- Intro (НАЧАЛО видео): "${context.introText || "не задан"}"
- Outro (КОНЕЦ видео): "${context.outroText || "не задан"}"

⚠️ СТРУКТУРА LOOP-ВИДЕО (запомни порядок!):
1. INTRO (начало) → факты → OUTRO (конец) → снова INTRO → факты → OUTRO → ...
2. Зритель смотрит по кругу бесконечно
3. После OUTRO сразу идёт INTRO — они должны склеиваться!

🔑 КЛЮЧЕВОЕ ПРАВИЛО:
- OUTRO (конец) заканчивается НЕЗАВЕРШЁННОЙ мыслью: "...потому что...", "...и тогда..."
- INTRO (начало) ПРОДОЛЖАЕТ эту мысль: "...это изменит всё!"
- При склейке OUTRO→INTRO получается ОДНО предложение

⛔⛔⛔ СТРОГО ЗАПРЕЩЕНО В LOOP-ВИДЕО (НАРУШЕНИЕ = ОШИБКА!):
❌ НИКАКИХ ПРИЗЫВОВ: "лайк", "подписка", "подпишись", "подписывайся", "колокольчик", "комментарий"
❌ НИКАКИХ: "ставь", "нажми", "жми", "оставляй", "делись", "поделись", "репост"
❌ НИКАКИХ: "оставайся с нами", "смотри до конца", "следи за каналом", "не пропусти", "досмотри"
❌ Loop-видео = ТОЛЬКО КОНТЕНТ, никаких призывов к действию!
❌ Intro как законченное предложение ("Загадочный факт...", "А знаете ли вы...")
❌ Outro как законченное предложение ("Вот такие факты!", "Это было интересно!")

❌ ТЫ ПЕРЕПУТАЛ МЕСТАМИ! ЭТО НЕПРАВИЛЬНО:
Intro: "Ставь лайк и подписывайся, потому что..." ← Это должно быть OUTRO! И без лайков!
Outro: "...учёные скрывали это!" ← Это должно быть INTRO!

✅ ПРАВИЛЬНЫЙ ПОРЯДОК:
OUTRO (конец видео, незавершённая мысль): "И это ещё не всё, ведь учёные скрывали от нас..."
INTRO (начало видео, продолжение): "...самый шокирующий факт о кино!"

Проверка: "...скрывали от нас самый шокирующий факт о кино! [факты] И это ещё не всё, ведь учёные скрывали от нас..." — БЕСШОВНЫЙ LOOP!

✅ ЕЩЁ ПРИМЕРЫ (обрати внимание на порядок OUTRO → INTRO):
1) OUTRO: "Но подожди, это ещё не самое странное, потому что..." → INTRO: "...сейчас будет факт который взорвёт мозг!"
2) OUTRO: "И если ты думаешь что это всё, то ты не слышал про..." → INTRO: "...то что скрывают от нас годами!"
3) OUTRO: "Учёные до сих пор не могут объяснить почему..." → INTRO: "...это происходит каждый день!"

КОГДА ГЕНЕРИРУЕШЬ LOOP ТЕКСТЫ:
1. OUTRO = незавершённое предложение (заканчивается на "...")
2. INTRO = продолжение этого предложения (начинается с "...")
3. НЕ ПУТАЙ местами! OUTRO это КОНЕЦ видео, INTRO это НАЧАЛО!
4. Проверь: прочитай "OUTRO + INTRO" — должно быть одно предложение
`
    : "";

  const systemPrompt = `Ты - AI помощник для редактирования видео. Ты помогаешь пользователю на уровне ОДНОГО СЕГМЕНТА видео.

КОНТЕКСТ СЕГМЕНТА:
- Тип сегмента: ${context.segmentType || "fact"}
- Индекс: ${context.segmentIndex ?? "неизвестно"}
- Текущий текст: "${context.segmentText || "пусто"}"
- Количество видео фонов: ${context.currentVideos?.length || 0}
- Loop-режим: ${context.useLoopScript ? "ДА (закольцованное видео)" : "НЕТ"}
${loopInfo}
ТЫ МОЖЕШЬ:
1. РЕДАКТИРОВАТЬ ТЕКСТ - переписать, упростить, сократить, расширить текст сегмента
2. ИСКАТЬ ВИДЕО - найти новые видео фоны по условиям пользователя (с лицами, природа, технологии и т.д.)

ВАЖНО:
- Отвечай кратко и по делу
- Если нужно изменить текст, верни action "updateText" с новым текстом
- Если нужно найти видео, верни action "searchVideos" с ключевыми словами
- Можешь выполнить несколько действий сразу

ФОРМАТ ОТВЕТА (JSON):
{
  "message": "Твой ответ пользователю на русском",
  "actions": [
    {
      "type": "updateText",
      "text": "Новый текст сегмента"
    },
    {
      "type": "searchVideos",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "requirements": "описание требований для фильтрации"
    }
  ]
}

ПРИМЕРЫ:
Пользователь: "сделай текст проще"
Ответ: { "message": "Упростил текст, теперь он понятнее", "actions": [{"type": "updateText", "text": "упрощённый текст"}] }

Пользователь: "найди видео с людьми"
Ответ: { "message": "Ищу видео с людьми для этого сегмента", "actions": [{"type": "searchVideos", "keywords": ["people face close up", "human emotion expression", "person talking camera"], "requirements": "видео с лицами людей"}] }

Пользователь: "перепиши текст и найди видео с природой"
Ответ: { "message": "Переписал текст и ищу видео с природой", "actions": [{"type": "updateText", "text": "новый текст"}, {"type": "searchVideos", "keywords": ["nature landscape", "forest trees", "mountain scenery"]}] }`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const { data: result } = await chatJSON(messages, {
      provider: provider,
      model: model,
      temperature: 0.7,
      maxTokens: 2000,
    });

    console.log("[AI Assistant] Segment response:", result);

    return {
      message: result.message || "Готово",
      actions: result.actions || [],
    };
  } catch (error) {
    console.error("[AI Assistant] Error:", error);
    throw new Error(`AI Assistant error: ${error.message}`);
  }
}

/**
 * Обрабатывает запрос на уровне всего видео
 * @param {string} userMessage - Сообщение пользователя
 * @param {Array} chatHistory - История чата
 * @param {object} context - Контекст видео
 * @param {string} context.title - Заголовок видео
 * @param {Array} context.segments - Все сегменты видео
 * @param {object} context.music - Текущая музыка
 * @param {object} context.template - Текущий шаблон
 * @param {boolean} context.useLoopScript - Это loop-видео (закольцованное)
 * @param {string} context.aiProvider - AI провайдер (openai, gemini)
 * @param {string} context.aiModel - AI модель
 * @returns {Promise<{message: string, actions: Array}>}
 */
async function processVideoRequest(
  userMessage,
  chatHistory = [],
  context = {},
) {
  const provider = context.aiProvider || DEFAULT_PROVIDER;
  const model = context.aiModel || null;

  console.log(
    `[AI Assistant] Processing video request with ${provider}:`,
    userMessage,
  );

  // Форматируем сегменты для контекста
  const segmentsInfo = (context.segments || [])
    .map(
      (s, i) =>
        `${i + 1}. [${s.type}] "${s.text?.substring(0, 80)}..." (видео: ${s.videos?.length || 0})`,
    )
    .join("\n");

  // Находим intro и outro для loop-контекста
  const introSegment = (context.segments || []).find((s) => s.type === "intro");
  const outroSegment = (context.segments || []).find((s) => s.type === "outro");

  // Информация о loop-режиме
  const loopInfo = context.useLoopScript
    ? `
=== 🔄 LOOP-РЕЖИМ АКТИВЕН — ЭТО САМОЕ ВАЖНОЕ! ===

ТЕКУЩИЕ ТЕКСТЫ:
- Intro (НАЧАЛО видео): "${introSegment?.text || "не задан"}"
- Outro (КОНЕЦ видео): "${outroSegment?.text || "не задан"}"

⚠️ СТРУКТУРА LOOP-ВИДЕО (запомни порядок!):
1. INTRO (начало) → факты → OUTRO (конец) → снова INTRO → факты → OUTRO → ...
2. Зритель смотрит по кругу бесконечно
3. После OUTRO сразу идёт INTRO — они должны склеиваться!

🔑 КЛЮЧЕВОЕ ПРАВИЛО:
- OUTRO (конец) заканчивается НЕЗАВЕРШЁННОЙ мыслью: "...потому что...", "...и тогда..."
- INTRO (начало) ПРОДОЛЖАЕТ эту мысль: "...это изменит всё!"
- При склейке OUTRO→INTRO получается ОДНО предложение

⛔⛔⛔ СТРОГО ЗАПРЕЩЕНО В LOOP-ВИДЕО (НАРУШЕНИЕ = ОШИБКА!):
❌ НИКАКИХ ПРИЗЫВОВ: "лайк", "подписка", "подпишись", "подписывайся", "колокольчик", "комментарий"
❌ НИКАКИХ: "ставь", "нажми", "жми", "оставляй", "делись", "поделись", "репост"
❌ НИКАКИХ: "оставайся с нами", "смотри до конца", "следи за каналом", "не пропусти", "досмотри"
❌ Loop-видео = ТОЛЬКО КОНТЕНТ, никаких призывов к действию!
❌ Intro как законченное предложение ("Загадочный факт...", "А знаете ли вы...")
❌ Outro как законченное предложение ("Вот такие факты!", "Это было интересно!")

❌ НЕ ПУТАЙ МЕСТАМИ! ЭТО НЕПРАВИЛЬНО:
Intro: "Ставь лайк потому что..." ← ЭТО ДОЛЖНО БЫТЬ OUTRO! И без лайков!
Outro: "...учёные скрывали!" ← ЭТО ДОЛЖНО БЫТЬ INTRO!

✅ ПРАВИЛЬНЫЙ ПОРЯДОК:
OUTRO (конец видео, незавершённая мысль): "И это ещё не всё, ведь учёные скрывали от нас..."
INTRO (начало видео, продолжение): "...самый шокирующий факт!"

Проверка склейки: "...скрывали от нас самый шокирующий факт! [факты] И это ещё не всё..." — БЕСШОВНО!

✅ ПРИМЕРЫ (порядок OUTRO → INTRO):
1) OUTRO: "Но подожди, это ещё не самое странное, потому что..." → INTRO: "...сейчас будет то что взорвёт мозг!"
2) OUTRO: "И если ты думаешь что это всё, то ты не слышал про..." → INTRO: "...то что скрывают годами!"
3) OUTRO: "Учёные до сих пор не могут объяснить почему..." → INTRO: "...это происходит каждый день!"

КОГДА ГЕНЕРИРУЕШЬ LOOP ТЕКСТЫ:
1. OUTRO = незавершённое предложение (заканчивается на "...")
2. INTRO = продолжение этого предложения (начинается с "...")
3. НЕ ПУТАЙ местами! OUTRO=КОНЕЦ, INTRO=НАЧАЛО!
4. Верни ОБА текста вместе через updateAllTexts
`
    : "";

  const systemPrompt = `Ты - AI помощник для редактирования ВСЕГО видео. Ты можешь делать массовые изменения.

КОНТЕКСТ ВИДЕО:
- Заголовок: "${context.title || "Без названия"}"
- Количество сегментов: ${context.segments?.length || 0}
- Музыка: ${context.music?.name || "не выбрана"} (${context.music?.mood || "unknown"})
- Шаблон: ${context.template?.name || "по умолчанию"}
- Loop-режим: ${context.useLoopScript ? "ДА (закольцованное видео)" : "НЕТ"}

СЕГМЕНТЫ:
${segmentsInfo || "Нет сегментов"}
${loopInfo}
ТЫ МОЖЕШЬ:
1. РЕДАКТИРОВАТЬ ВСЕ ТЕКСТЫ - переписать тексты всех сегментов
2. ИСКАТЬ ВИДЕО ДЛЯ ВСЕХ СЕГМЕНТОВ - найти новые видео фоны с условиями
3. ИСКАТЬ МУЗЫКУ - найти другую фоновую музыку
4. КОМБИНИРОВАННЫЕ ДЕЙСТВИЯ - несколько действий сразу

ФОРМАТ ОТВЕТА (JSON):
{
  "message": "Твой ответ пользователю на русском",
  "actions": [
    {
      "type": "updateAllTexts",
      "segments": [
        { "index": 0, "text": "Новый текст intro" },
        { "index": 1, "text": "Новый текст факта 1" }
      ],
      "style": "описание стиля изменений"
    },
    {
      "type": "searchAllVideos",
      "segmentKeywords": [
        { "index": 0, "keywords": ["keyword1", "keyword2"] },
        { "index": 1, "keywords": ["keyword3", "keyword4"] }
      ],
      "globalRequirements": "общие требования ко всем видео"
    },
    {
      "type": "searchMusic",
      "mood": "happy|epic|calm|energetic|dark|inspiring|mysterious",
      "tempo": "slow|medium|fast",
      "keywords": ["fun", "upbeat", "cheerful"],
      "description": "описание желаемой музыки"
    }
  ]
}

ВАЖНО для searchAllVideos:
- Генерируй 2-4 ключевых слова на АНГЛИЙСКОМ для каждого сегмента
- Ключевые слова должны быть ВИЗУАЛЬНЫМИ (описывать что видно на видео)
- Учитывай глобальные требования пользователя (например "с лицами людей")

ВАЖНО для searchMusic:
- mood: epic (эпичная), calm (спокойная), energetic (энергичная), dark (темная), happy (веселая), inspiring (вдохновляющая), mysterious (загадочная)
- tempo: slow (медленный), medium (средний), fast (быстрый)
- keywords: ключевые слова на английском для поиска музыки

ПРИМЕРЫ:

Пользователь: "используй простые слова во всех текстах"
Ответ: { "message": "Переписываю все тексты простыми словами", "actions": [{"type": "updateAllTexts", "segments": [...], "style": "простой язык"}] }

Пользователь: "найди видео с лицами людей для всех сегментов"
Ответ: { "message": "Ищу видео с людьми для всех сегментов", "actions": [{"type": "searchAllVideos", "segmentKeywords": [...], "globalRequirements": "видео с лицами людей"}] }

Пользователь: "найди более веселую музыку"
Ответ: { "message": "Ищу веселую музыку", "actions": [{"type": "searchMusic", "mood": "happy", "tempo": "medium", "keywords": ["fun", "cheerful", "upbeat"]}] }

Пользователь: "переделай видео фоны учитывая шаблон и чтоб были лица людей, найди веселую музыку, в текстах используй простые слова"
Ответ: { "message": "Выполняю все изменения: упрощаю тексты, ищу видео с людьми и веселую музыку", "actions": [{"type": "updateAllTexts", ...}, {"type": "searchAllVideos", ...}, {"type": "searchMusic", ...}] }`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...chatHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const { data: result } = await chatJSON(messages, {
      provider: provider,
      model: model,
      temperature: 0.7,
      maxTokens: 4000,
    });

    console.log("[AI Assistant] Video response:", result);

    return {
      message: result.message || "Готово",
      actions: result.actions || [],
    };
  } catch (error) {
    console.error("[AI Assistant] Error:", error);
    throw new Error(`AI Assistant error: ${error.message}`);
  }
}

module.exports = {
  processSegmentRequest,
  processVideoRequest,
};
