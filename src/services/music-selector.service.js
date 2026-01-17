/**
 * Сервис для ИИ-выбора музыки с использованием GPT-4o-mini
 * Анализирует метаданные треков и выбирает наиболее подходящий для темы видео
 */

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Выбирает лучший трек для видео с помощью ИИ
 * @param {string} videoTopic - Тема видео
 * @param {string} videoTitle - Заголовок видео
 * @param {Array} trackOptions - Массив треков с метаданными
 * @returns {Promise<object|null>} - Выбранный трек или null
 */
async function selectBestTrack(videoTopic, videoTitle, trackOptions) {
  if (!trackOptions || trackOptions.length === 0) {
    console.log("[MusicSelector] No tracks to select from");
    return null;
  }

  if (trackOptions.length === 1) {
    console.log("[MusicSelector] Only one track available, selecting it");
    return trackOptions[0];
  }

  try {
    // Подготавливаем описание треков для ИИ
    const tracksDescription = trackOptions
      .map((track, index) => {
        const genres = track.genres?.join(", ") || "unknown";
        const moods = track.moods?.join(", ") || "unknown";
        const speed = track.speed || "medium";
        const duration =
          Math.floor(track.duration / 60) +
          ":" +
          String(track.duration % 60).padStart(2, "0");

        return `${index + 1}. "${track.name}" by ${track.artist}
   - Жанры: ${genres}
   - Настроение: ${moods}
   - Темп: ${speed}
   - Длительность: ${duration}
   - Инструментальный: ${track.isInstrumental ? "да" : "нет"}`;
      })
      .join("\n\n");

    const prompt = `Ты эксперт по подбору фоновой музыки для YouTube Shorts видео.

ТЕМА ВИДЕО: ${videoTopic}
ЗАГОЛОВОК: ${videoTitle}

ДОСТУПНЫЕ ТРЕКИ:
${tracksDescription}

ЗАДАЧА:
Выбери ОДИН трек, который лучше всего подходит для этого видео как фоновая музыка.

КРИТЕРИИ ВЫБОРА:
1. Настроение музыки должно соответствовать теме видео
2. Темп должен подходить для динамики контента
3. Жанр должен усиливать восприятие контента
4. Инструментальная музыка предпочтительнее (не отвлекает от голоса)
5. Музыка не должна доминировать, а дополнять видео

ПРИМЕРЫ:
- Для "Топ 5 фактов о космосе" → ambient, electronic, mysterious
- Для "Мифы Древней Греции" → epic, cinematic, orchestral
- Для "Лайфхаки для дома" → upbeat, positive, corporate
- Для "Страшные истории" → dark, tense, atmospheric

Ответь ТОЛЬКО номером выбранного трека (1-${trackOptions.length}) и кратким объяснением почему.

Формат ответа:
ВЫБОР: [номер]
ПРИЧИНА: [краткое объяснение в 1-2 предложения]`;

    console.log(
      `[MusicSelector] Analyzing ${trackOptions.length} tracks for: "${videoTitle}"`
    );

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.3, // Низкая температура для более предсказуемого выбора
    });

    const answer = response.choices[0]?.message?.content || "";
    console.log(`[MusicSelector] AI response: ${answer}`);

    // Парсим ответ
    const choiceMatch = answer.match(/ВЫБОР:\s*(\d+)/i);
    const reasonMatch = answer.match(/ПРИЧИНА:\s*(.+)/i);

    if (choiceMatch) {
      const selectedIndex = parseInt(choiceMatch[1], 10) - 1;

      if (selectedIndex >= 0 && selectedIndex < trackOptions.length) {
        const selectedTrack = trackOptions[selectedIndex];
        const reason = reasonMatch ? reasonMatch[1].trim() : "AI selection";

        console.log(
          `[MusicSelector] Selected: "${selectedTrack.name}" by ${selectedTrack.artist}`
        );
        console.log(`[MusicSelector] Reason: ${reason}`);

        return selectedTrack;
      }
    }

    // Если не удалось распарсить, возвращаем первый трек
    console.log(
      "[MusicSelector] Could not parse AI response, using first track"
    );
    return trackOptions[0];
  } catch (error) {
    console.error("[MusicSelector] AI selection error:", error.message);
    // Fallback - возвращаем первый трек
    return trackOptions[0];
  }
}

module.exports = {
  selectBestTrack,
};
