const express = require("express");
const prisma = require("../services/db.service");
const { generateScript } = require("../services/ai.service");
const { generateAudio } = require("../services/voice.service");
const { renderVideo } = require("../services/render.service");

const router = express.Router();

// Хелпер для создания объекта прогресса
const createProgress = (
  generateScript = "waiting",
  generateAudio = "waiting",
  renderVideo = "waiting"
) => ({
  generateScript,
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
 * Запускает цепочку генерации: AI -> Voice -> Сохранение в БД
 */
router.post("/generate", async (req, res) => {
  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  let video = null;
  let progress = createProgress();

  try {
    // Создаем запись в БД со статусом PENDING и начальным прогрессом
    video = await prisma.video.create({
      data: {
        status: "GENERATING_ASSETS",
        title: "Generating...",
        scriptText: "",
        progress: JSON.stringify(progress),
      },
    });

    console.log(`Created video record: ${video.id}`);

    // Шаг 1: Генерируем сценарий через AI
    console.log("Generating script...");
    progress = createProgress("pending", "waiting", "waiting");
    video = await updateVideoProgress(video.id, {}, progress);

    const { title, script } = await generateScript(topic);

    // Сценарий готов
    progress = createProgress("success", "pending", "waiting");
    video = await updateVideoProgress(
      video.id,
      { title, scriptText: script },
      progress
    );

    // Шаг 2: Генерируем аудио
    console.log("Generating audio...");
    const audioPath = await generateAudio(script, video.id);

    // Аудио готово
    progress = createProgress("success", "success", "waiting");
    video = await updateVideoProgress(
      video.id,
      { audioPath, status: "PENDING" },
      progress
    );

    res.json({
      success: true,
      message: "Assets generated successfully",
      video: {
        ...video,
        progress: JSON.parse(video.progress),
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

    if (!video.audioPath) {
      return res.status(400).json({ error: "Audio not generated yet" });
    }

    // Парсим текущий прогресс
    let progress = video.progress
      ? JSON.parse(video.progress)
      : createProgress("success", "success", "waiting");

    // Обновляем статус на RENDERING и прогресс
    progress = createProgress("success", "success", "pending");
    await updateVideoProgress(id, { status: "RENDERING" }, progress);

    // Запускаем рендеринг (это может занять время)
    console.log(`Starting render for video: ${id}`);
    const videoPath = await renderVideo(video);

    // Обновляем запись с путем к видео и статусом COMPLETED
    progress = createProgress("success", "success", "success");
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
    const failedProgress = createProgress("success", "success", "failed");
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
 * POST /retry/:id
 * Повторная генерация видео с того шага, на котором произошла ошибка
 */
router.post("/retry/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Получаем видео из БД
    let video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    if (video.status !== "FAILED") {
      return res.status(400).json({
        error: "Only failed videos can be retried",
        currentStatus: video.status,
      });
    }

    // Парсим прогресс чтобы понять с какого шага начать
    let progress = video.progress
      ? JSON.parse(video.progress)
      : createProgress();

    console.log(`Retrying video ${id}, current progress:`, progress);

    // Определяем с какого шага начинать
    const needsScript = progress.generateScript !== "success";
    const needsAudio = progress.generateAudio !== "success";
    const needsRender = progress.renderVideo !== "success";

    // Обновляем статус на GENERATING_ASSETS
    video = await prisma.video.update({
      where: { id },
      data: { status: "GENERATING_ASSETS" },
    });

    // Шаг 1: Генерация скрипта (если нужно)
    if (needsScript) {
      console.log(`[Retry] Step 1: Generating script...`);
      progress = createProgress("pending", "waiting", "waiting");
      video = await updateVideoProgress(video.id, {}, progress);

      // Нам нужен topic - попробуем извлечь из title или использовать существующий scriptText
      const topic =
        video.title !== "Generating..." ? video.title : "Продолжение темы";
      const { title, script } = await generateScript(topic);

      progress = createProgress("success", "pending", "waiting");
      video = await updateVideoProgress(
        video.id,
        { title, scriptText: script },
        progress
      );
    }

    // Шаг 2: Генерация аудио (если нужно)
    if (needsAudio) {
      console.log(`[Retry] Step 2: Generating audio...`);

      // Если скрипт не генерировался сейчас, обновляем прогресс
      if (!needsScript) {
        progress = createProgress("success", "pending", "waiting");
        video = await updateVideoProgress(video.id, {}, progress);
      }

      const audioPath = await generateAudio(video.scriptText, video.id);

      progress = createProgress("success", "success", "waiting");
      video = await updateVideoProgress(
        video.id,
        { audioPath, status: "PENDING" },
        progress
      );
    }

    // Шаг 3: Рендеринг видео (если нужно И если аудио готово)
    if (needsRender && video.audioPath) {
      console.log(`[Retry] Step 3: Rendering video...`);

      progress = createProgress("success", "success", "pending");
      video = await updateVideoProgress(
        video.id,
        { status: "RENDERING" },
        progress
      );

      const videoPath = await renderVideo(video);

      progress = createProgress("success", "success", "success");
      video = await updateVideoProgress(
        video.id,
        { videoPath, status: "COMPLETED" },
        progress
      );
    } else if (!needsRender) {
      // Все шаги уже выполнены
      video = await prisma.video.update({
        where: { id },
        data: { status: "COMPLETED" },
      });
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
        generateAudio:
          currentProgress.generateAudio === "pending"
            ? "failed"
            : currentProgress.generateAudio,
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
