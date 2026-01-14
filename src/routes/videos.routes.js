const express = require("express");
const prisma = require("../services/db.service");
const { generateScript } = require("../services/ai.service");
const { generateAudio } = require("../services/voice.service");
const { renderVideo } = require("../services/render.service");

const router = express.Router();

/**
 * POST /generate
 * Запускает цепочку генерации: AI -> Voice -> Сохранение в БД
 */
router.post("/generate", async (req, res) => {
  const { topic } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  try {
    // Создаем запись в БД со статусом PENDING
    let video = await prisma.video.create({
      data: {
        status: "PENDING",
        title: "Generating...",
        scriptText: "",
      },
    });

    console.log(`Created video record: ${video.id}`);

    // Обновляем статус на GENERATING_ASSETS
    video = await prisma.video.update({
      where: { id: video.id },
      data: { status: "GENERATING_ASSETS" },
    });

    // Генерируем сценарий через AI
    console.log("Generating script...");
    const { title, script } = await generateScript(topic);

    // Обновляем запись с заголовком и текстом
    video = await prisma.video.update({
      where: { id: video.id },
      data: {
        title,
        scriptText: script,
      },
    });

    // Генерируем аудио
    console.log("Generating audio...");
    const audioPath = await generateAudio(script, video.id);

    // Обновляем запись с путем к аудио и статусом
    video = await prisma.video.update({
      where: { id: video.id },
      data: {
        audioPath,
        status: "PENDING", // Готов к рендерингу
      },
    });

    res.json({
      success: true,
      message: "Assets generated successfully",
      video,
    });
  } catch (error) {
    console.error("Generation error:", error);

    // Если есть video.id, обновляем статус на FAILED
    if (video?.id) {
      await prisma.video
        .update({
          where: { id: video.id },
          data: { status: "FAILED" },
        })
        .catch(console.error);
    }

    res.status(500).json({
      error: "Generation failed",
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

    if (!video.audioPath) {
      return res.status(400).json({ error: "Audio not generated yet" });
    }

    // Обновляем статус на RENDERING
    await prisma.video.update({
      where: { id },
      data: { status: "RENDERING" },
    });

    // Запускаем рендеринг (это может занять время)
    console.log(`Starting render for video: ${id}`);
    const videoPath = await renderVideo(video);

    // Обновляем запись с путем к видео и статусом COMPLETED
    const updatedVideo = await prisma.video.update({
      where: { id },
      data: {
        videoPath,
        status: "COMPLETED",
      },
    });

    res.json({
      success: true,
      message: "Video rendered successfully",
      video: updatedVideo,
    });
  } catch (error) {
    console.error("Render error:", error);

    // Обновляем статус на FAILED
    await prisma.video
      .update({
        where: { id },
        data: { status: "FAILED" },
      })
      .catch(console.error);

    res.status(500).json({
      error: "Render failed",
      message: error.message,
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

    res.json({
      success: true,
      videos,
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
      video,
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

module.exports = router;
