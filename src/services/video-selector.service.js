const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Использует GPT-4o Vision для выбора наиболее подходящих видео (одного или нескольких)
 * @param {string} segmentText - Текст сегмента (о чем говорится)
 * @param {Array} videoOptions - Массив видео с превью [{id, thumbnailUrl, duration, ...}]
 * @param {Array} excludeIds - Массив ID видео которые нужно исключить (уже использованы)
 * @param {number} estimatedDuration - Примерная длительность сегмента в секундах
 * @returns {Promise<Array>} - Массив выбранных видео с процентами [{...video, percent}, ...]
 */
async function selectBestVideos(
  segmentText,
  videoOptions,
  excludeIds = [],
  estimatedDuration = 5
) {
  if (!videoOptions || videoOptions.length === 0) {
    console.log("[VideoSelector] No video options provided");
    return [];
  }

  // Фильтруем уже использованные видео
  const availableVideos = videoOptions.filter(
    (v) => !excludeIds.includes(v.id) && !excludeIds.includes(String(v.id))
  );

  if (availableVideos.length === 0) {
    console.log(
      "[VideoSelector] All videos already used, falling back to first option"
    );
    return [{ ...videoOptions[0], percent: 100 }];
  }

  if (availableVideos.length === 1) {
    console.log("[VideoSelector] Only one available option, selecting it");
    return [{ ...availableVideos[0], percent: 100 }];
  }

  // Ограничиваем количество видео для анализа (экономия токенов)
  const maxVideosToAnalyze = 8;
  const videosToAnalyze = availableVideos.slice(0, maxVideosToAnalyze);

  console.log(
    `[VideoSelector] Analyzing ${videosToAnalyze.length} videos (excluded ${
      excludeIds.length
    } used) for: "${segmentText.substring(0, 50)}..."`
  );

  try {
    // Формируем контент с изображениями
    const imageContents = videosToAnalyze.map((video, index) => ({
      type: "image_url",
      image_url: {
        url: video.thumbnailUrl,
        detail: "low", // Экономим токены, low достаточно для выбора
      },
    }));

    // Формируем информацию о длительности каждого видео
    const videoDurations = videosToAnalyze
      .map((v, i) => `Видео ${i + 1}: ${v.duration || "неизвестно"} сек`)
      .join(", ");

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Ты помощник для выбора фоновых видео для YouTube Shorts.

Твоя задача: выбрать ОДНО или НЕСКОЛЬКО видео для фона озвученного текста.

КОГДА ВЫБИРАТЬ НЕСКОЛЬКО ВИДЕО:
1. Если лучшее видео слишком короткое (< 3 сек) — добавь похожее
2. Если текст описывает ПОСЛЕДОВАТЕЛЬНОСТЬ или ПРОЦЕСС — несколько видео показывают этапы
3. Если текст содержит КОНТРАСТ или СРАВНЕНИЕ — 2 разных видео
4. Если текст о ПЕРЕХОДЕ (было → стало) — 2 видео

КОГДА ДОСТАТОЧНО ОДНОГО ВИДЕО:
1. Видео достаточно длинное (> 5 сек)
2. Текст об одном явлении/объекте
3. Нет явной необходимости в смене кадра

Критерии выбора каждого видео:
1. ВИЗУАЛЬНОЕ СООТВЕТСТВИЕ - видео должно иллюстрировать тему
2. АТМОСФЕРА - настроение должно соответствовать тексту
3. НЕ ОТВЛЕКАЮЩЕЕ - не должно конкурировать с текстом за внимание

Отвечай ТОЛЬКО в формате JSON:
{
  "videos": [
    {"number": 1, "percent": 100}
  ],
  "reason": "краткое объяснение выбора"
}

Или для нескольких:
{
  "videos": [
    {"number": 2, "percent": 40},
    {"number": 5, "percent": 60}
  ],
  "reason": "Первое видео показывает начало, второе — результат"
}

ВАЖНО: 
- Сумма percent ДОЛЖНА быть 100
- Если одно видео — percent: 100
- Минимальный percent для видео: 20 (чтобы было заметно)
- Максимум 3 видео на сегмент`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Текст сегмента: "${segmentText}"
Примерная длительность сегмента: ~${estimatedDuration} секунд

Доступные видео (${videosToAnalyze.length} штук):
${videoDurations}

Вот превью видео:`,
            },
            ...imageContents,
            {
              type: "text",
              text: `Выбери видео для этого сегмента. Помни: обычно достаточно одного хорошего видео. Несколько видео нужны только если есть веская причина.`,
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const answer = response.choices[0].message.content.trim();
    const result = JSON.parse(answer);

    if (
      result.videos &&
      Array.isArray(result.videos) &&
      result.videos.length > 0
    ) {
      const selectedVideos = [];

      for (const selection of result.videos) {
        const videoIndex = selection.number - 1;
        if (videoIndex >= 0 && videoIndex < videosToAnalyze.length) {
          selectedVideos.push({
            ...videosToAnalyze[videoIndex],
            percent:
              selection.percent || Math.floor(100 / result.videos.length),
          });
        }
      }

      if (selectedVideos.length > 0) {
        // Нормализуем проценты чтобы сумма была 100
        const totalPercent = selectedVideos.reduce(
          (sum, v) => sum + v.percent,
          0
        );
        if (totalPercent !== 100) {
          const factor = 100 / totalPercent;
          selectedVideos.forEach(
            (v) => (v.percent = Math.round(v.percent * factor))
          );
          // Корректируем последний элемент чтобы точно было 100
          const adjustedTotal = selectedVideos.reduce(
            (sum, v) => sum + v.percent,
            0
          );
          selectedVideos[selectedVideos.length - 1].percent +=
            100 - adjustedTotal;
        }

        console.log(
          `[VideoSelector] AI selected ${
            selectedVideos.length
          } video(s): ${selectedVideos
            .map((v) => `#${v.id} (${v.percent}%)`)
            .join(", ")}`
        );
        console.log(
          `[VideoSelector] Reason: ${result.reason || "not provided"}`
        );

        return selectedVideos;
      }
    }

    // Fallback если парсинг не удался
    console.log(
      `[VideoSelector] Invalid AI response, falling back to first video`
    );
    return [{ ...videosToAnalyze[0], percent: 100 }];
  } catch (error) {
    console.error("[VideoSelector] AI selection failed:", error.message);
    // Fallback: выбираем первое доступное видео
    return [{ ...availableVideos[0], percent: 100 }];
  }
}

/**
 * Простой выбор одного лучшего видео (для обратной совместимости)
 */
async function selectBestVideo(segmentText, videoOptions, excludeIds = []) {
  const result = await selectBestVideos(
    segmentText,
    videoOptions,
    excludeIds,
    5
  );
  return result.length > 0 ? result[0] : null;
}

/**
 * Выбирает лучшее видео из нескольких источников
 * @param {string} segmentText - Текст сегмента
 * @param {Array} pexelsVideos - Видео из Pexels с thumbnailUrl
 * @param {Array} pixabayVideos - Видео из Pixabay с thumbnailUrl
 * @returns {Promise<object>} - Лучшее видео
 */
async function selectFromMultipleSources(
  segmentText,
  pexelsVideos = [],
  pixabayVideos = []
) {
  // Объединяем все видео
  const allVideos = [
    ...pexelsVideos.map((v) => ({ ...v, source: "pexels" })),
    ...pixabayVideos.map((v) => ({ ...v, source: "pixabay" })),
  ];

  if (allVideos.length === 0) {
    return null;
  }

  return selectBestVideo(segmentText, allVideos);
}

module.exports = {
  selectBestVideo,
  selectBestVideos,
  selectFromMultipleSources,
};
