const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Использует GPT-4o Vision для выбора наиболее подходящего видео
 * @param {string} segmentText - Текст сегмента (о чем говорится)
 * @param {Array} videoOptions - Массив видео с превью [{id, thumbnailUrl, ...}]
 * @param {Array} excludeIds - Массив ID видео которые нужно исключить (уже использованы)
 * @returns {Promise<object>} - Выбранное видео
 */
async function selectBestVideo(segmentText, videoOptions, excludeIds = []) {
  if (!videoOptions || videoOptions.length === 0) {
    console.log("[VideoSelector] No video options provided");
    return null;
  }

  // Фильтруем уже использованные видео
  const availableVideos = videoOptions.filter(
    (v) => !excludeIds.includes(v.id) && !excludeIds.includes(String(v.id))
  );

  if (availableVideos.length === 0) {
    console.log(
      "[VideoSelector] All videos already used, falling back to first option"
    );
    return videoOptions[0];
  }

  if (availableVideos.length === 1) {
    console.log("[VideoSelector] Only one available option, selecting it");
    return availableVideos[0];
  }

  // Ограничиваем количество видео для анализа (экономия токенов)
  const maxVideosToAnalyze = 6;
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Ты помощник для выбора фонового видео для YouTube Shorts.

Твоя задача: выбрать ОДНО видео, которое лучше всего подходит как ФОНОВОЕ видео для озвученного текста.

Критерии выбора:
1. ВИЗУАЛЬНОЕ СООТВЕТСТВИЕ - видео должно иллюстрировать тему текста
2. АТМОСФЕРА - настроение видео должно соответствовать тексту
3. НЕ ОТВЛЕКАЮЩЕЕ - видео не должно конкурировать с текстом за внимание

Примеры хорошего выбора:
- Текст о космосе → видео звезд, планет, галактик
- Текст о Древнем Риме → видео древних руин, статуй, храмов
- Текст о боге Аиде → темное видео, подземелье, пещеры, огонь
- Текст о природе → видео лесов, океанов, животных

Примеры ПЛОХОГО выбора:
- Текст о богах → видео современного города
- Текст о мифологии → видео танцующей девушки
- Серьезная тема → слишком яркое/веселое видео

Отвечай ТОЛЬКО номером выбранного видео (1, 2, 3...).`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Текст сегмента: "${segmentText}"

Вот ${videosToAnalyze.length} вариантов видео (превью):`,
            },
            ...imageContents,
            {
              type: "text",
              text: `Выбери номер видео (от 1 до ${videosToAnalyze.length}), которое лучше всего подходит как фон для этого текста:`,
            },
          ],
        },
      ],
      max_tokens: 10,
      temperature: 0.3,
    });

    const answer = response.choices[0].message.content.trim();
    const selectedIndex = parseInt(answer) - 1;

    if (selectedIndex >= 0 && selectedIndex < videosToAnalyze.length) {
      console.log(
        `[VideoSelector] AI selected video #${selectedIndex + 1} (ID: ${
          videosToAnalyze[selectedIndex].id
        })`
      );
      return videosToAnalyze[selectedIndex];
    } else {
      console.log(
        `[VideoSelector] Invalid AI response: "${answer}", falling back to first video`
      );
      return videosToAnalyze[0];
    }
  } catch (error) {
    console.error("[VideoSelector] AI selection failed:", error.message);
    // Fallback: выбираем первое доступное видео
    return availableVideos[0];
  }
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
  selectFromMultipleSources,
};
