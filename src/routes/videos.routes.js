const express = require("express");
const prisma = require("../services/db.service");
const { generateScript } = require("../services/ai.service");
const {
  generateAudio,
  generateSegmentsAudio,
} = require("../services/voice.service");
const { renderVideo } = require("../services/render.service");
const { findVideosForSegments } = require("../services/pexels.service");
const {
  getRandomPreview,
  getPreviewDuration,
} = require("../services/preview.service");

const router = express.Router();

// Расширенный хелпер для создания объекта прогресса (5 шагов)
const createProgress = (
  generateScript = "waiting",
  searchVideos = "waiting",
  generateAudio = "waiting",
  processSegments = "waiting",
  renderVideo = "waiting"
) => ({
  generateScript,
  searchVideos,
  generateAudio,
  processSegments,
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
 * Запускает цепочку генерации: AI -> Pexels -> Voice -> Сохранение в БД
 */
router.post("/generate", async (req, res) => {
  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

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

    // Шаг 1: Генерируем сценарий через AI (с сегментами)
    console.log("Step 1: Generating script with segments...");
    progress = createProgress(
      "pending",
      "waiting",
      "waiting",
      "waiting",
      "waiting"
    );
    video = await updateVideoProgress(video.id, {}, progress);

    const aiResult = await generateScript(topic);
    let segments = aiResult.segments || [];

    // Сценарий готов
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

    // Шаг 2: Ищем стоковые видео на Pexels для каждого сегмента
    console.log("Step 2: Searching stock videos on Pexels...");
    segments = await findVideosForSegments(segments);

    progress = createProgress(
      "success",
      "success",
      "pending",
      "waiting",
      "waiting"
    );
    video = await updateVideoProgress(
      video.id,
      { segments: JSON.stringify(segments) },
      progress
    );

    // Шаг 3: Генерируем аудио для каждого сегмента
    console.log("Step 3: Generating audio for segments...");
    segments = await generateSegmentsAudio(segments, video.id);

    progress = createProgress(
      "success",
      "success",
      "success",
      "pending",
      "waiting"
    );
    video = await updateVideoProgress(
      video.id,
      { segments: JSON.stringify(segments) },
      progress
    );

    // Шаг 4: Генерируем общее аудио для intro/outro и добавляем заставку
    console.log("Step 4: Processing segments...");

    // Получаем рандомную заставку
    const preview = await getRandomPreview();
    let previewDuration = 3;
    if (preview) {
      previewDuration = await getPreviewDuration(preview.filename);
      console.log(`[Preview] Duration: ${previewDuration.toFixed(1)}s`);
    }

    // Генерируем аудио для intro и outro
    const introAudio = await generateAudio(
      aiResult.intro || "Привет!",
      `${video.id}_intro`
    );
    const outroAudio = await generateAudio(
      aiResult.outro || "Подписывайся!",
      `${video.id}_outro`
    );

    // Добавляем заставку + intro/outro как отдельные сегменты
    const fullSegments = [
      // Заставка в начале (без текста, только видео)
      ...(preview
        ? [
            {
              type: "preview",
              text: "",
              previewUrl: preview.url,
              audioDuration: previewDuration,
            },
          ]
        : []),
      { type: "intro", text: aiResult.intro, audioPath: introAudio },
      ...segments.map((s) => ({ ...s, type: "fact" })),
      { type: "outro", text: aiResult.outro, audioPath: outroAudio },
    ];

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
        segments: JSON.stringify(fullSegments),
        status: "PENDING",
      },
      progress
    );

    res.json({
      success: true,
      message: "Assets generated successfully",
      video: {
        ...video,
        progress: JSON.parse(video.progress),
        segments: fullSegments,
      },
    });
  } catch (error) {
    console.error("Generation error:", error);

    // Если есть video.id, обновляем статус на FAILED с текущим прогрессом
    if (video?.id) {
      // Определяем на каком шаге произошла ошибка
      const failedProgress = {
        ...progress,
        // Помечаем текущий pending шаг как failed
        ...(progress.generateScript === "pending" && {
          generateScript: "failed",
        }),
        ...(progress.searchVideos === "pending" && { searchVideos: "failed" }),
        ...(progress.generateAudio === "pending" && {
          generateAudio: "failed",
        }),
        ...(progress.processSegments === "pending" && {
          processSegments: "failed",
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
    }

    res.status(500).json({
      error: "Generation failed",
      message: error.message,
      progress,
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

module.exports = router;
