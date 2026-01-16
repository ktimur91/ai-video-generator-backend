const express = require("express");
const prisma = require("../services/db.service");
const { generateScript } = require("../services/ai.service");
const {
  generateAudio,
  generateSegmentsAudio,
} = require("../services/voice.service");
const { renderVideo } = require("../services/render.service");
const {
  findVideosForSegments: findVideosForSegmentsPexels,
  searchSingleVideo: searchSingleVideoPexels,
} = require("../services/pexels.service");
const {
  findVideosForSegments: findVideosForSegmentsPixabay,
  searchSingleVideo: searchSingleVideoPixabay,
} = require("../services/pixabay.service");
const { searchVideo: searchKlipyVideo } = require("../services/klipy.service");
const { getRandomBackgroundMusic } = require("../services/music.service");

const router = express.Router();

// Хранилище для отслеживания активных генераций (videoId -> aborted)
const activeGenerations = new Map();

// Проверяет, была ли генерация остановлена
const isGenerationAborted = (videoId) =>
  activeGenerations.get(videoId) === true;

// Устанавливает флаг остановки
const abortGeneration = (videoId) => activeGenerations.set(videoId, true);

// Сбрасывает флаг при начале новой генерации
const startGeneration = (videoId) => activeGenerations.set(videoId, false);

// Очищает запись после завершения
const cleanupGeneration = (videoId) => activeGenerations.delete(videoId);

// Расширенный хелпер для создания объекта прогресса (5 шагов - НОВЫЙ ПОРЯДОК)
// 1. generateScript - AI генерирует текст
// 2. searchVideos - Подбор видео + музыки
// 3. awaitingReview - Ожидание ручной проверки
// 4. generateAudio - Генерация озвучки после одобрения
// 5. renderVideo - Рендеринг
const createProgress = (
  generateScript = "waiting",
  searchVideos = "waiting",
  awaitingReview = "waiting",
  generateAudio = "waiting",
  renderVideo = "waiting"
) => ({
  generateScript,
  searchVideos,
  awaitingReview,
  generateAudio,
  renderVideo,
});

// Хелпер для обновления видео с прогрессом
const updateVideoProgress = async (videoId, data, progress) => {
  return prisma.video.update({
    where: { id: videoId },
    data: {
      ...data,
      progress: JSON.stringify(progress),
    },
  });
};

/**
 * POST /generate
 * НОВЫЙ ФЛОУ:
 * 1. AI генерирует текст (интро, сегменты, аутро) - без аудио
 * 2. Подбор видео фонов + выбор фоновой музыки
 * 3. Останавливается на статусе AWAITING_REVIEW для ручной проверки
 */
router.post("/generate", async (req, res) => {
  const { topic, videoSource = "pexels" } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  // Выбираем функции поиска в зависимости от источника
  let findVideosForSegments;
  let searchSingleVideo;

  if (videoSource === "pixabay") {
    findVideosForSegments = findVideosForSegmentsPixabay;
    searchSingleVideo = searchSingleVideoPixabay;
  } else if (videoSource === "klipy") {
    // Для Klipy используем обёртку, т.к. у него другой API
    findVideosForSegments = async (segments) => {
      const results = [];
      for (const segment of segments) {
        let video = await searchKlipyVideo(segment.searchKeywords || []);
        results.push({ ...segment, stockVideo: video });
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return results;
    };
    searchSingleVideo = searchKlipyVideo;
  } else {
    findVideosForSegments = findVideosForSegmentsPexels;
    searchSingleVideo = searchSingleVideoPexels;
  }

  console.log(`[VideoSource] Using ${videoSource} for video search`);

  let video = null;
  let progress = createProgress();

  try {
    // Создаем запись в БД со статусом GENERATING_ASSETS и начальным прогрессом
    video = await prisma.video.create({
      data: {
        status: "GENERATING_ASSETS",
        title: "Generating...",
        scriptText: "",
        progress: JSON.stringify(progress),
      },
    });

    console.log(`Created video record: ${video.id}`);

    // Начинаем отслеживание генерации
    startGeneration(video.id);

    // ========== ШАГ 1: AI генерирует текст ==========
    console.log("Step 1: Generating script with segments...");
    progress = createProgress(
      "pending",
      "waiting",
      "waiting",
      "waiting",
      "waiting"
    );
    video = await updateVideoProgress(video.id, {}, progress);

    // Проверка остановки
    if (isGenerationAborted(video.id)) {
      cleanupGeneration(video.id);
      return res.json({
        success: true,
        message: "Generation stopped by user",
        stopped: true,
      });
    }

    const aiResult = await generateScript(topic);
    const tags = aiResult.tags || ["shorts", "факты", "интересное"];
    const hashtags = aiResult.hashtags || ["#interesting", "#интересное"];

    // Формируем сегменты БЕЗ аудио (аудио будет генерироваться после одобрения)
    let segments = [
      {
        type: "intro",
        text: aiResult.intro,
        searchKeywords: aiResult.introKeywords || [
          "energy",
          "dynamic",
          "action",
        ],
      },
      ...(aiResult.segments || []).map((s, idx) => ({
        ...s,
        type: "fact",
        number: idx + 1,
      })),
      {
        type: "outro",
        text: aiResult.outro,
        searchKeywords: aiResult.outroKeywords || [
          "subscribe",
          "like button",
          "notification bell",
        ],
      },
    ];

    // Проверка остановки после шага 1
    if (isGenerationAborted(video.id)) {
      cleanupGeneration(video.id);
      await updateVideoProgress(
        video.id,
        {
          title: aiResult.title,
          scriptText: aiResult.script,
          segments: JSON.stringify(segments),
          tags: JSON.stringify(tags),
          hashtags: JSON.stringify(hashtags),
          status: "PENDING",
        },
        createProgress("success", "waiting", "waiting", "waiting", "waiting")
      );
      return res.json({
        success: true,
        message: "Generation stopped by user",
        stopped: true,
      });
    }

    // Сценарий готов, переходим к поиску видео
    progress = createProgress(
      "success",
      "pending",
      "waiting",
      "waiting",
      "waiting"
    );
    video = await updateVideoProgress(
      video.id,
      {
        title: aiResult.title,
        scriptText: aiResult.script,
        segments: JSON.stringify(segments),
        tags: JSON.stringify(tags),
        hashtags: JSON.stringify(hashtags),
      },
      progress
    );

    // ========== ШАГ 2: Подбор видео фонов + музыки ==========
    console.log(`Step 2: Searching stock videos on ${videoSource}...`);

    // Ищем видео для каждого сегмента
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const keywords = segment.searchKeywords || [];

      if (keywords.length > 0) {
        console.log(
          `[Segment ${i}] Searching video with keywords: ${keywords.join(", ")}`
        );
        const stockVideo = await searchSingleVideo(keywords, segment.type);
        segments[i].stockVideo = stockVideo;
      }
    }

    // Получаем рандомную фоновую музыку
    const bgMusic = await getRandomBackgroundMusic();
    if (bgMusic) {
      console.log(`[Music] Using background music: ${bgMusic.filename}`);
    }

    // Проверка остановки после шага 2
    if (isGenerationAborted(video.id)) {
      cleanupGeneration(video.id);
      await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
          backgroundMusicUrl: bgMusic?.url || null,
          backgroundMusicFilename: bgMusic?.filename || null,
          status: "PENDING",
        },
        createProgress("success", "success", "waiting", "waiting", "waiting")
      );
      return res.json({
        success: true,
        message: "Generation stopped by user",
        stopped: true,
      });
    }

    // ========== ШАГ 3: Ожидание ручной проверки ==========
    // Останавливаемся здесь и ждём одобрения пользователя
    progress = createProgress(
      "success",
      "success",
      "pending",
      "waiting",
      "waiting"
    );

    const videoData = {
      segments: JSON.stringify(segments),
      backgroundMusicUrl: bgMusic?.url || null,
      backgroundMusicFilename: bgMusic?.filename || null,
      status: "AWAITING_REVIEW", // Новый статус!
    };

    video = await updateVideoProgress(video.id, videoData, progress);

    // Очищаем отслеживание генерации
    cleanupGeneration(video.id);

    res.json({
      success: true,
      message: "Ready for review. Please check text and video backgrounds.",
      awaitingReview: true,
      video: {
        ...video,
        progress: JSON.parse(video.progress),
        segments: segments,
      },
    });
  } catch (error) {
    console.error("Generation error:", error);

    // Если есть video.id, обновляем статус на FAILED с текущим прогрессом
    if (video?.id) {
      const failedProgress = {
        ...progress,
        ...(progress.generateScript === "pending" && {
          generateScript: "failed",
        }),
        ...(progress.searchVideos === "pending" && { searchVideos: "failed" }),
        ...(progress.awaitingReview === "pending" && {
          awaitingReview: "failed",
        }),
        ...(progress.generateAudio === "pending" && {
          generateAudio: "failed",
        }),
        ...(progress.renderVideo === "pending" && { renderVideo: "failed" }),
      };

      await prisma.video
        .update({
          where: { id: video.id },
          data: {
            status: "FAILED",
            progress: JSON.stringify(failedProgress),
          },
        })
        .catch(console.error);

      cleanupGeneration(video.id);
    }

    res.status(500).json({
      error: "Generation failed",
      message: error.message,
      progress,
    });
  }
});

/**
 * POST /approve/:id
 * Одобряет видео после ручной проверки и запускает генерацию аудио
 */
router.post("/approve/:id", async (req, res) => {
  const { id } = req.params;
  const {
    segments: updatedSegments,
    backgroundMusicFilename,
    voiceConfigId,
  } = req.body;

  try {
    const video = await prisma.video.findUnique({ where: { id } });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    if (video.status !== "AWAITING_REVIEW" && video.status !== "PENDING") {
      return res.status(400).json({
        error: "Video is not awaiting review",
        currentStatus: video.status,
      });
    }

    // Если переданы обновленные сегменты, используем их
    // Иначе берем из базы
    let segments = updatedSegments
      ? typeof updatedSegments === "string"
        ? JSON.parse(updatedSegments)
        : updatedSegments
      : typeof video.segments === "string"
      ? JSON.parse(video.segments)
      : video.segments;

    // Обновляем backgroundMusicFilename и voiceConfigId если переданы
    const updateData = {};
    if (backgroundMusicFilename !== undefined) {
      updateData.backgroundMusicFilename = backgroundMusicFilename || null;
    }
    if (voiceConfigId !== undefined) {
      updateData.voiceConfigId = voiceConfigId || null;
    }
    if (Object.keys(updateData).length > 0) {
      await prisma.video.update({
        where: { id },
        data: updateData,
      });
    }

    // Получаем настройки голоса если указан voiceConfigId
    let voiceConfig = null;
    if (voiceConfigId) {
      voiceConfig = await prisma.voiceConfig.findUnique({
        where: { id: voiceConfigId },
      });
    }
    // Если голос не указан, пробуем найти голос по умолчанию
    if (!voiceConfig) {
      voiceConfig = await prisma.voiceConfig.findFirst({
        where: { isDefault: true },
      });
    }

    // Начинаем отслеживание генерации
    startGeneration(video.id);

    // ========== ШАГ 4: Генерация аудио ==========
    console.log("Step 4: Generating audio for all segments...");
    let progress = createProgress(
      "success",
      "success",
      "success",
      "pending",
      "waiting"
    );
    await updateVideoProgress(
      video.id,
      { status: "GENERATING_ASSETS" },
      progress
    );

    // Генерируем аудио для каждого сегмента
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Проверка остановки
      if (isGenerationAborted(video.id)) {
        cleanupGeneration(video.id);
        await updateVideoProgress(
          video.id,
          {
            segments: JSON.stringify(segments),
            status: "PENDING",
          },
          createProgress("success", "success", "success", "waiting", "waiting")
        );
        return res.json({
          success: true,
          message: "Generation stopped by user",
          stopped: true,
        });
      }

      console.log(
        `[Audio] Generating for segment ${i + 1}/${segments.length}: ${
          segment.type
        }`
      );

      const segmentId =
        segment.type === "intro"
          ? `${video.id}_intro`
          : segment.type === "outro"
          ? `${video.id}_outro`
          : `${video.id}_segment_${segment.number || i}`;

      // Передаём настройки голоса в generateAudio
      const audio = await generateAudio(segment.text, segmentId, voiceConfig);
      segments[i].audioPath = audio.path;
      segments[i].audioDuration = audio.duration;

      // Транскрибируем для получения таймингов слов (для субтитров)
      try {
        const {
          transcribeWithTimings,
        } = require("../services/whisper.service");
        const path = require("path");
        const fullAudioPath = path.join(__dirname, "../../", audio.path);
        const wordTimings = await transcribeWithTimings(fullAudioPath);
        segments[i].wordTimings = wordTimings;
        console.log(
          `[Whisper] Segment ${i + 1}: ${wordTimings.length} words with timings`
        );
      } catch (err) {
        console.error(`[Whisper] Failed for segment ${i + 1}:`, err.message);
        segments[i].wordTimings = [];
      }
    }

    // Аудио готово, можно рендерить
    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "waiting"
    );
    await updateVideoProgress(
      video.id,
      {
        segments: JSON.stringify(segments),
        status: "PENDING",
      },
      progress
    );

    cleanupGeneration(video.id);

    res.json({
      success: true,
      message: "Audio generated successfully. Ready for rendering.",
      video: {
        ...video,
        segments,
        progress,
        status: "PENDING",
        backgroundMusicFilename:
          backgroundMusicFilename !== undefined
            ? backgroundMusicFilename || null
            : video.backgroundMusicFilename,
      },
    });
  } catch (error) {
    console.error("Approve/Audio generation error:", error);
    res.status(500).json({
      error: "Audio generation failed",
      message: error.message,
    });
  }
});

/**
 * POST /stop/:id
 * Останавливает процесс генерации видео
 */
router.post("/stop/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Устанавливаем флаг остановки
    abortGeneration(id);

    // Получаем текущий прогресс
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    const currentProgress = JSON.parse(video.progress || "{}");

    // Помечаем текущий pending шаг как waiting (остановлен)
    const stoppedProgress = {
      ...currentProgress,
      ...(currentProgress.generateScript === "pending" && {
        generateScript: "waiting",
      }),
      ...(currentProgress.searchVideos === "pending" && {
        searchVideos: "waiting",
      }),
      ...(currentProgress.awaitingReview === "pending" && {
        awaitingReview: "waiting",
      }),
      ...(currentProgress.generateAudio === "pending" && {
        generateAudio: "waiting",
      }),
      ...(currentProgress.renderVideo === "pending" && {
        renderVideo: "waiting",
      }),
    };

    // Обновляем статус на PENDING (можно перезапустить)
    await prisma.video.update({
      where: { id },
      data: {
        status: "PENDING",
        progress: JSON.stringify(stoppedProgress),
      },
    });

    console.log(`[Stop] Generation stopped for video: ${id}`);

    res.json({
      success: true,
      message: "Generation stopped",
    });
  } catch (error) {
    console.error("Stop error:", error);
    res.status(500).json({
      error: "Failed to stop generation",
      message: error.message,
    });
  }
});

/**
 * GET /background-music
 * Получает список доступной фоновой музыки
 */
router.get("/background-music", async (req, res) => {
  try {
    const { getAvailableMusic } = require("../services/music.service");
    const tracks = await getAvailableMusic();
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

    const musicList = tracks.map((filename) => ({
      filename,
      url: `${backendUrl}/storage/background-musics/${filename}`,
      name: filename.replace(/\.[^.]+$/, "").replace(/_/g, " "),
    }));

    res.json({
      success: true,
      music: musicList,
    });
  } catch (error) {
    console.error("Error getting background music:", error);
    res.status(500).json({
      error: "Failed to get background music",
      message: error.message,
    });
  }
});

/**
 * PATCH /videos/:id/background-music
 * Обновляет фоновую музыку для видео
 */
router.patch("/videos/:id/background-music", async (req, res) => {
  const { id } = req.params;
  const { backgroundMusicUrl, backgroundMusicFilename } = req.body;

  try {
    const video = await prisma.video.update({
      where: { id },
      data: {
        backgroundMusicUrl,
        backgroundMusicFilename,
      },
    });

    res.json({
      success: true,
      video,
    });
  } catch (error) {
    console.error("Error updating background music:", error);
    res.status(500).json({
      error: "Failed to update background music",
      message: error.message,
    });
  }
});

/**
 * POST /render/:id
 * Запускает процесс рендеринга видео через Remotion
 */
router.post("/render/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Получаем видео из БД
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Проверяем что есть сегменты
    if (!video.segments) {
      return res.status(400).json({ error: "Segments not generated yet" });
    }

    // Парсим текущий прогресс
    let progress = video.progress
      ? JSON.parse(video.progress)
      : createProgress("success", "success", "success", "success", "waiting");

    // Обновляем статус на RENDERING и прогресс
    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "pending"
    );
    await updateVideoProgress(id, { status: "RENDERING" }, progress);

    // Запускаем рендеринг (это может занять время)
    console.log(`Starting render for video: ${id}`);
    const videoPath = await renderVideo(video);

    // Обновляем запись с путем к видео и статусом COMPLETED
    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "success"
    );
    const updatedVideo = await updateVideoProgress(
      id,
      {
        videoPath,
        status: "COMPLETED",
      },
      progress
    );

    res.json({
      success: true,
      message: "Video rendered successfully",
      video: {
        ...updatedVideo,
        progress: JSON.parse(updatedVideo.progress),
      },
    });
  } catch (error) {
    console.error("Render error:", error);

    // Обновляем статус на FAILED с прогрессом
    const failedProgress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "failed"
    );
    await prisma.video
      .update({
        where: { id },
        data: {
          status: "FAILED",
          progress: JSON.stringify(failedProgress),
        },
      })
      .catch(console.error);

    res.status(500).json({
      error: "Render failed",
      message: error.message,
      progress: failedProgress,
    });
  }
});

/**
 * GET /videos
 * Возвращает список всех видео
 */
router.get("/videos", async (req, res) => {
  try {
    const videos = await prisma.video.findMany({
      orderBy: { createdAt: "desc" },
    });

    // Парсим progress для каждого видео
    const videosWithParsedProgress = videos.map((video) => ({
      ...video,
      progress: video.progress ? JSON.parse(video.progress) : null,
    }));

    res.json({
      success: true,
      videos: videosWithParsedProgress,
    });
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({
      error: "Failed to fetch videos",
      message: error.message,
    });
  }
});

/**
 * GET /videos/:id
 * Возвращает конкретное видео по ID
 */
router.get("/videos/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    res.json({
      success: true,
      video: {
        ...video,
        progress: video.progress ? JSON.parse(video.progress) : null,
      },
    });
  } catch (error) {
    console.error("Error fetching video:", error);
    res.status(500).json({
      error: "Failed to fetch video",
      message: error.message,
    });
  }
});

/**
 * DELETE /videos/:id
 * Удаляет видео по ID
 */
router.delete("/videos/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const video = await prisma.video.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Video deleted",
      video,
    });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({
      error: "Failed to delete video",
      message: error.message,
    });
  }
});

/**
 * PATCH /videos/:id
 * Обновляет данные видео (скрипт, заголовок)
 */
router.patch("/videos/:id", async (req, res) => {
  const { id } = req.params;
  const { title, scriptText } = req.body;

  try {
    const video = await prisma.video.findUnique({ where: { id } });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (scriptText !== undefined) updateData.scriptText = scriptText;

    const updatedVideo = await prisma.video.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      video: {
        ...updatedVideo,
        progress: updatedVideo.progress
          ? JSON.parse(updatedVideo.progress)
          : null,
      },
    });
  } catch (error) {
    console.error("Error updating video:", error);
    res.status(500).json({
      error: "Failed to update video",
      message: error.message,
    });
  }
});

/**
 * POST /retry/:id
 * Повторная генерация видео с указанного шага
 * Body: { fromStep: 1-5 } - с какого шага начать
 * 1=скрипт, 2=поиск видео, 3=аудио, 4=обработка сегментов, 5=рендеринг
 */
router.post("/retry/:id", async (req, res) => {
  const { id } = req.params;
  const { fromStep } = req.body;

  try {
    // Получаем видео из БД
    let video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Разрешаем retry для FAILED и COMPLETED/PENDING (для ручного перезапуска)
    const allowedStatuses = ["FAILED", "COMPLETED", "PENDING"];
    if (!allowedStatuses.includes(video.status)) {
      return res.status(400).json({
        error: "Cannot retry video in current status",
        currentStatus: video.status,
      });
    }

    // Парсим текущие данные
    let progress = video.progress
      ? JSON.parse(video.progress)
      : createProgress();
    let segments = video.segments ? JSON.parse(video.segments) : [];

    console.log(`Retrying video ${id}, fromStep: ${fromStep}`);

    // Определяем с какого шага начинать
    const step = fromStep || 1;

    // Обновляем статус на GENERATING_ASSETS
    video = await prisma.video.update({
      where: { id },
      data: { status: "GENERATING_ASSETS" },
    });

    // Шаг 1: Генерация скрипта
    if (step <= 1) {
      console.log(`[Retry] Step 1: Generating script...`);
      progress = createProgress(
        "pending",
        "waiting",
        "waiting",
        "waiting",
        "waiting"
      );
      video = await updateVideoProgress(video.id, {}, progress);

      const topic =
        video.title !== "Generating..." ? video.title : "Интересные факты";
      const aiResult = await generateScript(topic);
      segments = aiResult.segments || [];

      progress = createProgress(
        "success",
        "pending",
        "waiting",
        "waiting",
        "waiting"
      );
      video = await updateVideoProgress(
        video.id,
        {
          title: aiResult.title,
          scriptText: aiResult.script,
          segments: JSON.stringify(segments),
        },
        progress
      );
    }

    // Шаг 2: Поиск стоковых видео
    if (step <= 2) {
      console.log(`[Retry] Step 2: Searching stock videos...`);
      if (step === 2) {
        progress = createProgress(
          "success",
          "pending",
          "waiting",
          "waiting",
          "waiting"
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Получаем сегменты для поиска (только те что без stockVideo)
      const segmentsToSearch = segments.filter(
        (s) => !s.stockVideo && s.searchKeywords
      );
      if (segmentsToSearch.length > 0) {
        const updatedSegments = await findVideosForSegments(segmentsToSearch);
        // Обновляем сегменты
        segments = segments.map((s) => {
          const updated = updatedSegments.find((u) => u.number === s.number);
          return updated || s;
        });
      }

      progress = createProgress(
        "success",
        "success",
        "pending",
        "waiting",
        "waiting"
      );
      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
        },
        progress
      );
    }

    // Шаг 3: Генерация аудио для сегментов
    if (step <= 3) {
      console.log(`[Retry] Step 3: Generating audio for segments...`);
      if (step === 3) {
        progress = createProgress(
          "success",
          "success",
          "pending",
          "waiting",
          "waiting"
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Генерируем аудио только для сегментов без аудио
      const factSegments = segments.filter(
        (s) => s.type !== "intro" && s.type !== "outro"
      );
      const segmentsWithAudio = await generateSegmentsAudio(
        factSegments.filter((s) => !s.audioPath),
        video.id
      );

      // Обновляем сегменты
      segments = segments.map((s) => {
        const updated = segmentsWithAudio.find((u) => u.number === s.number);
        return updated || s;
      });

      progress = createProgress(
        "success",
        "success",
        "success",
        "pending",
        "waiting"
      );
      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
        },
        progress
      );
    }

    // Шаг 4: Обработка сегментов (intro/outro)
    if (step <= 4) {
      console.log(`[Retry] Step 4: Processing segments...`);
      if (step === 4) {
        progress = createProgress(
          "success",
          "success",
          "success",
          "pending",
          "waiting"
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Проверяем наличие intro/outro
      const hasIntro = segments.some((s) => s.type === "intro");
      const hasOutro = segments.some((s) => s.type === "outro");

      if (!hasIntro) {
        const introAudio = await generateAudio(
          "Привет! Смотри интересные факты!",
          `${video.id}_intro`
        );
        segments.unshift({
          type: "intro",
          text: "Привет!",
          audioPath: introAudio,
        });
      }

      if (!hasOutro) {
        const outroAudio = await generateAudio(
          "Подпишись на канал!",
          `${video.id}_outro`
        );
        segments.push({
          type: "outro",
          text: "Подпишись!",
          audioPath: outroAudio,
        });
      }

      progress = createProgress(
        "success",
        "success",
        "success",
        "success",
        "waiting"
      );
      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
          status: "PENDING",
        },
        progress
      );
    }

    // Шаг 5: Рендеринг видео
    if (step <= 5 && segments.length > 0) {
      console.log(`[Retry] Step 5: Rendering video...`);
      progress = createProgress(
        "success",
        "success",
        "success",
        "success",
        "pending"
      );
      video = await updateVideoProgress(
        video.id,
        { status: "RENDERING" },
        progress
      );

      const videoPath = await renderVideo(video);

      progress = createProgress(
        "success",
        "success",
        "success",
        "success",
        "success"
      );
      video = await updateVideoProgress(
        video.id,
        {
          videoPath,
          status: "COMPLETED",
        },
        progress
      );
    }

    res.json({
      success: true,
      message: "Retry completed successfully",
      video: {
        ...video,
        progress:
          typeof video.progress === "string"
            ? JSON.parse(video.progress)
            : progress,
        segments:
          typeof video.segments === "string"
            ? JSON.parse(video.segments)
            : segments,
      },
    });
  } catch (error) {
    console.error("Retry error:", error);

    // Определяем на каком шаге произошла ошибка
    try {
      const currentVideo = await prisma.video.findUnique({ where: { id } });
      let currentProgress = currentVideo?.progress
        ? JSON.parse(currentVideo.progress)
        : createProgress();

      // Помечаем pending шаг как failed
      const failedProgress = {
        generateScript:
          currentProgress.generateScript === "pending"
            ? "failed"
            : currentProgress.generateScript,
        searchVideos:
          currentProgress.searchVideos === "pending"
            ? "failed"
            : currentProgress.searchVideos,
        generateAudio:
          currentProgress.generateAudio === "pending"
            ? "failed"
            : currentProgress.generateAudio,
        processSegments:
          currentProgress.processSegments === "pending"
            ? "failed"
            : currentProgress.processSegments,
        renderVideo:
          currentProgress.renderVideo === "pending"
            ? "failed"
            : currentProgress.renderVideo,
      };

      await prisma.video.update({
        where: { id },
        data: {
          status: "FAILED",
          progress: JSON.stringify(failedProgress),
        },
      });
    } catch (updateError) {
      console.error("Failed to update video status:", updateError);
    }

    res.status(500).json({
      error: "Retry failed",
      message: error.message,
    });
  }
});

/**
 * GET /search-videos
 * Поиск видео по ключевым словам для ручного выбора фона
 */
router.get("/search-videos", async (req, res) => {
  const {
    q,
    source = "pexels",
    page = 1,
    verticalOnly = "true",
    pos = null,
  } = req.query;
  const pageNum = parseInt(page) || 1;
  const perPage = 20;
  const isVerticalOnly = verticalOnly === "true";

  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' is required" });
  }

  try {
    const keywords = q.split(",").map((k) => k.trim());
    let videos = [];
    let totalHits = 0;
    let hasMore = false;
    let nextPos = null; // Для cursor-based пагинации (Klipy)

    if (source === "pixabay") {
      // Делаем прямой запрос к Pixabay API чтобы получить список видео
      const axios = require("axios");
      const PIXABAY_API_KEY =
        process.env.PIXABAY_API_KEY || "54210869-6670fd220da2b2c1de7759e59";

      console.log(
        `[Pixabay Search] Query: ${keywords[0]}, Page: ${pageNum}, VerticalOnly: ${isVerticalOnly}`
      );

      const response = await axios.get("https://pixabay.com/api/videos/", {
        params: {
          key: PIXABAY_API_KEY,
          q: keywords[0],
          per_page: 100, // Запрашиваем много для фильтрации
          page: pageNum,
          video_type: "all",
          safesearch: true,
        },
      });

      totalHits = response.data.totalHits || 0;
      console.log(
        `[Pixabay Search] Found ${
          response.data.hits?.length || 0
        } videos, total: ${totalHits}`
      );

      let filteredVideos = (response.data.hits || []).filter((v) => {
        const medium = v.videos?.medium;
        const durationOk = v.duration >= 3 && v.duration <= 60;

        if (isVerticalOnly) {
          const isVertical = medium && medium.height > medium.width;
          return isVertical && durationOk;
        }
        return durationOk;
      });

      console.log(`[Pixabay Search] Filtered videos: ${filteredVideos.length}`);

      videos = filteredVideos
        .slice(0, perPage)
        .map((v) => {
          const videoFile =
            v.videos?.large || v.videos?.medium || v.videos?.small;
          const isVertical = videoFile && videoFile.height > videoFile.width;
          return {
            id: v.id,
            url: videoFile?.url,
            width: videoFile?.width,
            height: videoFile?.height,
            duration: v.duration,
            photographer: v.user,
            thumbnail: v.videos?.tiny?.thumbnail || null,
            isVertical,
          };
        })
        .filter((v) => v.url);

      hasMore = filteredVideos.length > perPage || pageNum * 100 < totalHits;
      console.log(
        `[Pixabay Search] Final videos: ${videos.length}, hasMore: ${hasMore}`
      );
    } else if (source === "klipy") {
      // Klipy API для клипов (cursor-based pagination)
      const { searchClips } = require("../services/klipy.service");

      console.log(
        `[Klipy Search] Query: ${keywords[0]}, Page: ${pageNum}, Pos: ${
          pos || "none"
        }`
      );

      const result = await searchClips(keywords[0], {
        page: pageNum,
        limit: perPage,
        pos: pos, // cursor для пагинации
      });

      videos = result.videos;
      hasMore = result.hasMore;
      totalHits = videos.length;
      nextPos = result.nextPos; // Сохраняем cursor для следующей страницы
    } else {
      // Pexels - делаем прямой запрос к API чтобы получить список видео
      const axios = require("axios");
      const PEXELS_API_KEY =
        process.env.PEXELS_API_KEY ||
        "js7zzQQH8u0HaLesjtFvn9WOBSpgwH6rXXvtqFSCANXiQQvovLTeTMjO";

      console.log(
        `[Pexels Search] Query: ${keywords[0]}, Page: ${pageNum}, VerticalOnly: ${isVerticalOnly}`
      );

      const response = await axios.get("https://api.pexels.com/videos/search", {
        headers: { Authorization: PEXELS_API_KEY },
        params: {
          query: keywords[0],
          orientation: isVerticalOnly ? "portrait" : undefined,
          per_page: perPage,
          page: pageNum,
          size: "medium",
        },
      });

      totalHits = response.data.total_results || 0;
      hasMore = pageNum * perPage < totalHits;

      videos = (response.data.videos || [])
        .filter((v) => v.duration >= 3 && v.duration <= 60)
        .map((v) => {
          const videoFile =
            v.video_files.find((f) => f.height > f.width) || v.video_files[0];
          const isVertical = videoFile && videoFile.height > videoFile.width;
          return {
            id: v.id,
            url: videoFile?.link,
            width: videoFile?.width,
            height: videoFile?.height,
            duration: v.duration,
            photographer: v.user?.name,
            thumbnail: v.image,
            isVertical,
          };
        })
        .filter((v) => v.url);
    }

    res.json({
      success: true,
      source,
      query: q,
      page: pageNum,
      hasMore,
      totalHits,
      videos,
      ...(nextPos && { nextPos }), // Cursor для следующей страницы (Klipy)
    });
  } catch (error) {
    console.error("Error searching videos:", error);
    res.status(500).json({
      error: "Failed to search videos",
      message: error.message,
    });
  }
});

/**
 * PATCH /videos/:id/segments
 * Обновляет сегменты видео (для ручной замены видео-фонов)
 */
router.patch("/videos/:id/segments", async (req, res) => {
  const { id } = req.params;
  const { segments } = req.body;

  if (!segments || !Array.isArray(segments)) {
    return res.status(400).json({ error: "Segments array is required" });
  }

  try {
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Обновляем сегменты
    const updatedVideo = await prisma.video.update({
      where: { id },
      data: {
        segments: JSON.stringify(segments),
        status: "PENDING", // Сбрасываем статус для перерендера
      },
    });

    res.json({
      success: true,
      message: "Segments updated successfully",
      video: {
        ...updatedVideo,
        segments: JSON.parse(updatedVideo.segments),
        progress: updatedVideo.progress
          ? JSON.parse(updatedVideo.progress)
          : null,
      },
    });
  } catch (error) {
    console.error("Error updating segments:", error);
    res.status(500).json({
      error: "Failed to update segments",
      message: error.message,
    });
  }
});

// ============================================================
// YOUTUBE API ROUTES
// ============================================================

const youtubeService = require("../services/youtube.service");

/**
 * GET /youtube/status
 * Проверка статуса авторизации YouTube
 */
router.get("/youtube/status", async (req, res) => {
  try {
    const isAuthenticated = youtubeService.isAuthenticated();
    console.log("[YouTube Status] isAuthenticated:", isAuthenticated);

    if (isAuthenticated) {
      try {
        const channel = await youtubeService.getChannelInfo();
        console.log("[YouTube Status] channel:", channel);
        res.json({
          authenticated: true,
          channel,
        });
      } catch (error) {
        // Токен невалидный, нужна повторная авторизация
        console.error("[YouTube Status] getChannelInfo error:", error.message);
        res.json({
          authenticated: false,
          error: "Token expired or invalid: " + error.message,
        });
      }
    } else {
      res.json({
        authenticated: false,
      });
    }
  } catch (error) {
    res.status(500).json({
      error: "Failed to check YouTube status",
      message: error.message,
    });
  }
});

/**
 * GET /youtube/auth
 * Получение URL для авторизации YouTube
 */
router.get("/youtube/auth", (req, res) => {
  try {
    const authUrl = youtubeService.getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate auth URL",
      message: error.message,
    });
  }
});

/**
 * GET /youtube/callback
 * OAuth2 callback от Google
 */
router.get("/youtube/callback", async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`http://localhost:5173?youtube_error=${error}`);
    }

    if (!code) {
      return res.redirect(`http://localhost:5173?youtube_error=no_code`);
    }

    await youtubeService.handleAuthCallback(code);

    // Редирект обратно на дашборд с успехом
    res.redirect(`http://localhost:5173?youtube_connected=true`);
  } catch (error) {
    console.error("YouTube OAuth callback error:", error);
    res.redirect(
      `http://localhost:5173?youtube_error=${encodeURIComponent(error.message)}`
    );
  }
});

/**
 * POST /youtube/logout
 * Выход из YouTube аккаунта
 */
router.post("/youtube/logout", (req, res) => {
  try {
    youtubeService.logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: "Failed to logout",
      message: error.message,
    });
  }
});

/**
 * POST /videos/:id/publish
 * Публикация видео на YouTube
 */
router.post("/videos/:id/publish", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      privacyStatus = "private", // private, public, unlisted
      customTitle,
      customDescription,
      tags = [],
      categoryId = "24", // Default: Entertainment
    } = req.body;

    // Проверяем авторизацию
    if (!youtubeService.isAuthenticated()) {
      return res.status(401).json({
        error: "YouTube not authenticated",
        message: "Please connect your YouTube account first",
      });
    }

    // Получаем видео из БД
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    if (!video.videoPath) {
      return res.status(400).json({
        error: "Video not rendered",
        message: "Please wait for video rendering to complete",
      });
    }

    // Проверяем что файл существует
    const fs = require("fs");
    const path = require("path");
    const videoPath = path.isAbsolute(video.videoPath)
      ? video.videoPath
      : path.join(__dirname, "../../", video.videoPath);

    if (!fs.existsSync(videoPath)) {
      return res.status(400).json({
        error: "Video file not found",
        message: "The rendered video file is missing",
      });
    }

    // Формируем описание
    const description =
      customDescription || `${video.title}\n\n#shorts #youtube #video`;

    // Получаем теги из видео если не переданы
    let finalTags = tags;
    if (finalTags.length === 0 && video.tags) {
      try {
        finalTags = JSON.parse(video.tags);
      } catch {
        finalTags = ["shorts", "факты", "интересное"];
      }
    }
    if (finalTags.length === 0) {
      finalTags = ["shorts", "video"];
    }

    // Загружаем на YouTube
    const result = await youtubeService.uploadVideo({
      videoPath,
      title: customTitle || video.title,
      description,
      tags: finalTags,
      categoryId,
      privacyStatus,
    });

    // Обновляем запись в БД
    await prisma.video.update({
      where: { id },
      data: {
        youtubeId: result.id,
        youtubeUrl: result.url,
        youtubeStatus: privacyStatus,
        publishedAt: new Date(),
      },
    });

    res.json({
      success: true,
      youtube: result,
    });
  } catch (error) {
    console.error("YouTube publish error:", error);
    res.status(500).json({
      error: "Failed to publish video",
      message: error.message,
    });
  }
});

module.exports = router;
