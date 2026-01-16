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
const { getRandomBackgroundMusic } = require("../services/music.service");

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
 * Запускает цепочку генерации: AI -> Pexels/Pixabay -> Voice -> Сохранение в БД
 */
router.post("/generate", async (req, res) => {
  const { topic, videoSource = "pexels" } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  // Выбираем функции поиска в зависимости от источника
  const findVideosForSegments =
    videoSource === "pixabay"
      ? findVideosForSegmentsPixabay
      : findVideosForSegmentsPexels;

  const searchSingleVideo =
    videoSource === "pixabay"
      ? searchSingleVideoPixabay
      : searchSingleVideoPexels;

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
    const tags = aiResult.tags || ["shorts", "факты", "интересное"];
    const hashtags = aiResult.hashtags || ["#interesting", "#интересное"];

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
        tags: JSON.stringify(tags),
        hashtags: JSON.stringify(hashtags),
      },
      progress
    );

    // Шаг 2: Ищем стоковые видео для каждого сегмента
    console.log(`Step 2: Searching stock videos on ${videoSource}...`);
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

    // Шаг 4: Генерируем общее аудио для intro/outro и ищем видео для них
    console.log("Step 4: Processing segments...");

    // Ищем видео для intro и outro из выбранного источника
    const introKeywords = aiResult.introKeywords || [
      "energy",
      "dynamic",
      "action",
    ];
    const outroKeywords = aiResult.outroKeywords || [
      "subscribe",
      "like button",
      "notification bell",
    ];

    console.log(
      `[Intro] Searching video with keywords: ${introKeywords.join(", ")}`
    );
    const introVideo = await searchSingleVideo(introKeywords, "intro");

    console.log(
      `[Outro] Searching video with keywords: ${outroKeywords.join(", ")}`
    );
    const outroVideo = await searchSingleVideo(outroKeywords, "outro");

    // Получаем рандомную фоновую музыку (будет глобальной для всего видео)
    const bgMusic = await getRandomBackgroundMusic();
    if (bgMusic) {
      console.log(`[Music] Using background music: ${bgMusic.filename}`);
    }

    // Генерируем аудио для intro и outro (теперь возвращает {path, duration})
    const introAudio = await generateAudio(
      aiResult.intro || "Привет!",
      `${video.id}_intro`
    );
    const outroAudio = await generateAudio(
      aiResult.outro || "Подписывайся!",
      `${video.id}_outro`
    );

    // Собираем все сегменты
    // Фоновая музыка теперь будет глобальной (передаётся на уровне видео, не сегментов)
    const fullSegments = [
      {
        type: "intro",
        text: aiResult.intro,
        audioPath: introAudio.path,
        audioDuration: introAudio.duration, // Длительность для синхронизации видео
        stockVideo: introVideo, // Видео из выбранного источника
      },
      ...segments.map((s) => ({
        ...s,
        type: "fact",
      })),
      {
        type: "outro",
        text: aiResult.outro,
        audioPath: outroAudio.path,
        audioDuration: outroAudio.duration, // Длительность для синхронизации видео
        stockVideo: outroVideo, // Видео из выбранного источника
      },
    ];

    // Сохраняем URL фоновой музыки отдельно для глобального использования
    const videoData = {
      segments: JSON.stringify(fullSegments),
      backgroundMusicUrl: bgMusic?.url || null, // Глобальная фоновая музыка
      status: "PENDING",
    };

    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "waiting"
    );
    video = await updateVideoProgress(video.id, videoData, progress);

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

/**
 * GET /search-videos
 * Поиск видео по ключевым словам для ручного выбора фона
 */
router.get("/search-videos", async (req, res) => {
  const { q, source = "pexels", page = 1, verticalOnly = "true" } = req.query;
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
    } else {
      // Делаем прямой запрос к API чтобы получить список видео
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
