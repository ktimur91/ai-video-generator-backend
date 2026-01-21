const { getProvider, DEFAULT_PROVIDER } = require("./ai-providers");

// Для vision используем OpenAI напрямую (gpt-4o поддерживает vision)
// TODO: Добавить поддержку Gemini Vision в будущем
const OpenAI = require("openai");
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * Использует GPT-4o Vision для выбора наиболее подходящих видео (одного или нескольких)
 * @param {string} segmentText - Текст сегмента (о чем говорится)
 * @param {Array} videoOptions - Массив видео с превью [{id, thumbnailUrl, duration, ...}]
 * @param {Array} excludeIds - Массив ID видео которые нужно исключить (уже использованы)
 * @param {number} estimatedDuration - Примерная длительность сегмента в секундах
 * @param {number} maxClipDuration - Максимальная длительность одного клипа в секундах (из шаблона)
 * @returns {Promise<Array>} - Массив выбранных видео с процентами [{...video, percent}, ...]
 */
async function selectBestVideos(
  segmentText,
  videoOptions,
  excludeIds = [],
  estimatedDuration = 5,
  maxClipDuration = 3,
) {
  if (!videoOptions || videoOptions.length === 0) {
    console.log("[VideoSelector] No video options provided");
    return [];
  }

  // Рассчитываем минимальное количество видео на основе maxClipDuration
  const minVideosRequired = Math.ceil(estimatedDuration / maxClipDuration);
  console.log(
    `[VideoSelector] Segment duration: ${estimatedDuration}s, maxClipDuration: ${maxClipDuration}s, min videos needed: ${minVideosRequired}`,
  );

  // Фильтруем уже использованные видео
  const availableVideos = videoOptions.filter(
    (v) => !excludeIds.includes(v.id) && !excludeIds.includes(String(v.id)),
  );

  if (availableVideos.length === 0) {
    console.log(
      "[VideoSelector] All videos already used, falling back to first option",
    );
    return [{ ...videoOptions[0], percent: 100 }];
  }

  if (availableVideos.length === 1) {
    console.log("[VideoSelector] Only one available option, selecting it");
    return [{ ...availableVideos[0], percent: 100 }];
  }

  // Ограничиваем количество видео для анализа (экономия токенов)
  // Увеличиваем лимит если нужно много видео
  const maxVideosToAnalyze = Math.max(8, minVideosRequired + 4);
  const videosToAnalyze = availableVideos.slice(0, maxVideosToAnalyze);

  console.log(
    `[VideoSelector] Analyzing ${videosToAnalyze.length} videos (excluded ${
      excludeIds.length
    } used) for: "${segmentText.substring(0, 50)}..."`,
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

    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Ты помощник для выбора фоновых видео для YouTube Shorts.

Твоя задача: выбрать НЕСКОЛЬКО видео для фона озвученного текста.

ВАЖНОЕ ПРАВИЛО: Каждый клип не должен длиться дольше ${maxClipDuration} секунд.
Для сегмента длительностью ${estimatedDuration} секунд нужно МИНИМУМ ${minVideosRequired} видео.

КРИТЕРИИ ВЫБОРА:
1. ВИЗУАЛЬНОЕ СООТВЕТСТВИЕ - видео должно иллюстрировать тему
2. РАЗНООБРАЗИЕ - выбирай разные видео, не похожие друг на друга
3. АТМОСФЕРА - настроение должно соответствовать тексту
4. НЕ ОТВЛЕКАЮЩЕЕ - не должно конкурировать с текстом за внимание

Отвечай ТОЛЬКО в формате JSON:
{
  "videos": [
    {"number": 1, "percent": 33},
    {"number": 3, "percent": 33},
    {"number": 5, "percent": 34}
  ],
  "reason": "краткое объяснение выбора"
}

ВАЖНО: 
- Выбери МИНИМУМ ${minVideosRequired} видео (больше можно, меньше нельзя!)
- Сумма percent ДОЛЖНА быть 100
- Минимальный percent для видео: ${Math.floor(100 / (minVideosRequired + 1))} (чтобы каждый клип был заметен)
- Распредели проценты примерно поровну между видео`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Текст сегмента: "${segmentText}"
Длительность сегмента: ~${estimatedDuration} секунд
Макс. длительность клипа: ${maxClipDuration} сек
Нужно выбрать: минимум ${minVideosRequired} видео

Доступные видео (${videosToAnalyze.length} штук):
${videoDurations}

Вот превью видео:`,
            },
            ...imageContents,
            {
              type: "text",
              text: `Выбери МИНИМУМ ${minVideosRequired} разных видео для этого сегмента, чтобы обеспечить динамичную смену кадров.`,
            },
          ],
        },
      ],
      max_tokens: 300,
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
      const usedIndices = new Set();

      for (const selection of result.videos) {
        const videoIndex = selection.number - 1;
        if (videoIndex >= 0 && videoIndex < videosToAnalyze.length) {
          selectedVideos.push({
            ...videosToAnalyze[videoIndex],
            percent:
              selection.percent || Math.floor(100 / result.videos.length),
          });
          usedIndices.add(videoIndex);
        }
      }

      // Если AI выбрал меньше видео чем требуется, добираем автоматически
      if (selectedVideos.length < minVideosRequired) {
        console.log(
          `[VideoSelector] AI selected only ${selectedVideos.length}, need ${minVideosRequired}. Adding more videos...`,
        );

        for (
          let i = 0;
          i < videosToAnalyze.length &&
          selectedVideos.length < minVideosRequired;
          i++
        ) {
          if (!usedIndices.has(i)) {
            selectedVideos.push({
              ...videosToAnalyze[i],
              percent: 0, // Будет пересчитано
            });
            usedIndices.add(i);
          }
        }
      }

      if (selectedVideos.length > 0) {
        // Распределяем проценты равномерно
        const equalPercent = Math.floor(100 / selectedVideos.length);
        selectedVideos.forEach((v, i) => {
          v.percent = equalPercent;
        });
        // Корректируем последний элемент чтобы точно было 100
        const adjustedTotal = selectedVideos.reduce(
          (sum, v) => sum + v.percent,
          0,
        );
        selectedVideos[selectedVideos.length - 1].percent +=
          100 - adjustedTotal;

        console.log(
          `[VideoSelector] Final selection: ${
            selectedVideos.length
          } video(s): ${selectedVideos
            .map((v) => `#${v.id} (${v.percent}%)`)
            .join(", ")}`,
        );
        console.log(
          `[VideoSelector] Reason: ${result.reason || "not provided"}`,
        );

        return selectedVideos;
      }
    }

    // Fallback если парсинг не удался - возвращаем нужное количество видео
    console.log(
      `[VideoSelector] Invalid AI response, falling back to ${minVideosRequired} videos`,
    );
    const fallbackVideos = videosToAnalyze.slice(0, minVideosRequired);
    const equalPercent = Math.floor(100 / fallbackVideos.length);
    return fallbackVideos.map((v, i) => ({
      ...v,
      percent:
        i === fallbackVideos.length - 1
          ? 100 - equalPercent * (fallbackVideos.length - 1)
          : equalPercent,
    }));
  } catch (error) {
    console.error("[VideoSelector] AI selection failed:", error.message);
    // Fallback: выбираем нужное количество видео
    const fallbackVideos = availableVideos.slice(0, minVideosRequired);
    const equalPercent = Math.floor(100 / Math.max(1, fallbackVideos.length));
    return fallbackVideos.map((v, i) => ({
      ...v,
      percent:
        i === fallbackVideos.length - 1
          ? 100 - equalPercent * (fallbackVideos.length - 1)
          : equalPercent,
    }));
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
    5,
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
  pixabayVideos = [],
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
