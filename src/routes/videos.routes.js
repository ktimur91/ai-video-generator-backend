const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const prisma = require("../services/db.service");
const {
  generateScript,
  generateTopicSuggestions,
  estimateDuration,
} = require("../services/ai.service");
const {
  generateAudio,
  generateSegmentsAudio,
} = require("../services/voice.service");
const { renderVideo } = require("../services/render.service");
const {
  findVideosForSegments: findVideosForSegmentsPexels,
  searchSingleVideo: searchSingleVideoPexels,
  searchVideosWithThumbnails: searchVideosWithThumbnailsPexels,
} = require("../services/pexels.service");
const {
  findVideosForSegments: findVideosForSegmentsPixabay,
  searchSingleVideo: searchSingleVideoPixabay,
  searchVideosWithThumbnails: searchVideosWithThumbnailsPixabay,
} = require("../services/pixabay.service");
const { searchVideo: searchKlipyVideo } = require("../services/klipy.service");
const { searchMusicForTopic } = require("../services/jamendo.service");
const { selectBestVideos } = require("../services/video-selector.service");
const { selectBestTrack } = require("../services/music-selector.service");

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
  renderVideo = "waiting",
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
  const {
    topic,
    videoSource = "pexels",
    useAIVideoSelection = false,
    useAIMusicSelection = false,
    templateId = null,
  } = req.body;

  if (!topic) {
    return res.status(400).json({ error: "Topic is required" });
  }

  // Выбираем функции поиска в зависимости от источника
  let findVideosForSegments;
  let searchSingleVideo;
  let searchVideosWithThumbnails;

  if (videoSource === "pixabay") {
    findVideosForSegments = findVideosForSegmentsPixabay;
    searchSingleVideo = searchSingleVideoPixabay;
    searchVideosWithThumbnails = searchVideosWithThumbnailsPixabay;
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
    searchVideosWithThumbnails = null; // Klipy не поддерживает AI-выбор
  } else {
    findVideosForSegments = findVideosForSegmentsPexels;
    searchSingleVideo = searchSingleVideoPexels;
    searchVideosWithThumbnails = searchVideosWithThumbnailsPexels;
  }

  console.log(
    `[VideoSource] Using ${videoSource} for video search${
      useAIVideoSelection ? " with AI video selection" : ""
    }${useAIMusicSelection ? " with AI music selection" : ""}`,
  );

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
        templateId: templateId,
      },
    });

    console.log(
      `Created video record: ${video.id}${templateId ? ` with template ${templateId}` : ""}`,
    );

    // Начинаем отслеживание генерации
    startGeneration(video.id);

    // ========== ШАГ 1: AI генерирует текст ==========
    console.log("Step 1: Generating script with segments...");
    progress = createProgress(
      "pending",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
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
    // Добавляем estimatedDuration и stockVideos (массив для нескольких видео)
    let segments = [
      {
        type: "intro",
        text: aiResult.intro,
        searchKeywords: aiResult.introKeywords || [
          "energy",
          "dynamic",
          "action",
        ],
        estimatedDuration: estimateDuration(aiResult.intro),
        stockVideos: [], // Массив видео с процентами
      },
      ...(aiResult.segments || []).map((s, idx) => ({
        ...s,
        type: "fact",
        number: idx + 1,
        estimatedDuration: estimateDuration(s.text),
        stockVideos: [],
      })),
      {
        type: "outro",
        text: aiResult.outro,
        searchKeywords: aiResult.outroKeywords || [
          "subscribe",
          "like button",
          "notification bell",
        ],
        estimatedDuration: estimateDuration(aiResult.outro),
        stockVideos: [],
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
        createProgress("success", "waiting", "waiting", "waiting", "waiting"),
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
      "waiting",
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
      progress,
    );

    // ========== ШАГ 2: Подбор видео фонов + музыки ==========
    console.log(`Step 2: Searching stock videos on ${videoSource}...`);

    // Отслеживаем уже использованные видео чтобы избежать повторов
    const usedVideoIds = [];

    // Ищем видео для каждого сегмента
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const keywords = segment.searchKeywords || [];

      if (keywords.length > 0) {
        console.log(
          `[Segment ${i}] Searching video with keywords: ${keywords.join(", ")}`,
        );

        // Если включен AI-выбор и доступна функция для этого источника
        if (useAIVideoSelection && searchVideosWithThumbnails) {
          // Получаем все подходящие видео с превью
          const videoOptions = await searchVideosWithThumbnails(keywords, {
            minDuration:
              segment.type === "intro" || segment.type === "outro" ? 3 : 5,
            maxDuration: 30,
          });

          if (videoOptions.length > 0) {
            // AI выбирает видео по превью (может выбрать несколько), исключая уже использованные
            const selectedVideos = await selectBestVideos(
              segment.text,
              videoOptions,
              usedVideoIds,
              segment.estimatedDuration,
            );

            // Записываем выбранные видео с процентами
            segments[i].stockVideos = selectedVideos.map((v) => {
              if (v.id) {
                usedVideoIds.push(v.id);
                usedVideoIds.push(String(v.id));
              }
              return {
                ...v,
                percent: v.percent || 100,
              };
            });

            // Для обратной совместимости сохраняем первое видео в stockVideo
            if (selectedVideos.length > 0) {
              segments[i].stockVideo = selectedVideos[0];
            }
          }
        } else {
          // Обычный случайный выбор — одно видео на 100%
          const stockVideo = await searchSingleVideo(keywords, segment.type);

          if (stockVideo) {
            // Запоминаем ID использованного видео
            if (stockVideo.id) {
              usedVideoIds.push(stockVideo.id);
              usedVideoIds.push(String(stockVideo.id));
            }

            segments[i].stockVideos = [
              {
                ...stockVideo,
                percent: 100,
              },
            ];
            // Для обратной совместимости
            segments[i].stockVideo = stockVideo;
          }
        }
      }
    }

    // Получаем фоновую музыку из Jamendo на основе AI-параметров
    let bgMusic = null;
    const musicParams = aiResult.music || {};

    try {
      console.log(`[Music] Searching music with params:`, musicParams);

      const musicTracks = await searchMusicForTopic({
        keywords: musicParams.keywords || ["background", "cinematic"],
        mood: musicParams.mood || "inspiring",
        tempo: musicParams.tempo || "medium",
        limit: useAIMusicSelection ? 10 : 5, // Больше треков для AI-выбора
      });

      if (musicTracks.length > 0) {
        let selectedTrack;

        if (useAIMusicSelection) {
          // AI анализирует треки и выбирает лучший
          console.log(
            `[Music] AI selecting best track from ${musicTracks.length} options...`,
          );
          selectedTrack = await selectBestTrack(
            topic,
            aiResult.title,
            musicTracks,
          );
        } else {
          // Берём первый (наиболее популярный) трек
          selectedTrack = musicTracks[0];
        }

        if (selectedTrack) {
          bgMusic = {
            id: selectedTrack.id,
            name: selectedTrack.name,
            artist: selectedTrack.artist,
            audioUrl: selectedTrack.audioUrl,
            downloadUrl: selectedTrack.downloadUrl,
            imageUrl: selectedTrack.imageUrl,
            duration: selectedTrack.duration,
            genres: selectedTrack.genres,
            moods: selectedTrack.moods,
            speed: selectedTrack.speed,
            isInstrumental: selectedTrack.isInstrumental,
            license: selectedTrack.license,
            source: "jamendo",
          };
          console.log(
            `[Music] Selected: "${selectedTrack.name}" by ${selectedTrack.artist}`,
          );
        }
      } else {
        console.log(
          `[Music] No tracks found, video will have no background music`,
        );
      }
    } catch (musicError) {
      console.error("[Music] Error searching music:", musicError.message);
    }

    // Проверка остановки после шага 2
    if (isGenerationAborted(video.id)) {
      cleanupGeneration(video.id);
      await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
          backgroundMusicUrl: bgMusic?.audioUrl || bgMusic?.downloadUrl || null,
          backgroundMusicFilename: bgMusic?.name
            ? `${bgMusic.name} - ${bgMusic.artist}`
            : null,
          backgroundMusicData: bgMusic ? JSON.stringify(bgMusic) : null,
          status: "PENDING",
        },
        createProgress("success", "success", "waiting", "waiting", "waiting"),
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
      "waiting",
    );

    const videoData = {
      segments: JSON.stringify(segments),
      backgroundMusicUrl: bgMusic?.audioUrl || bgMusic?.downloadUrl || null,
      backgroundMusicFilename: bgMusic?.name
        ? `${bgMusic.name} - ${bgMusic.artist}`
        : null,
      backgroundMusicData: bgMusic ? JSON.stringify(bgMusic) : null,
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
 * Одобряет видео после ручной проверки и запускает генерацию аудио + рендер
 * Работает асинхронно - сразу отвечает клиенту
 */
router.post("/approve/:id", async (req, res) => {
  const { id } = req.params;
  const {
    segments: updatedSegments,
    backgroundMusicData,
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
    let segments = updatedSegments
      ? typeof updatedSegments === "string"
        ? JSON.parse(updatedSegments)
        : updatedSegments
      : typeof video.segments === "string"
        ? JSON.parse(video.segments)
        : video.segments;

    // Обновляем данные
    const updateData = {
      segments: JSON.stringify(segments),
    };

    // templateId
    if (req.body.templateId !== undefined) {
      updateData.templateId = req.body.templateId || null;
    }

    if (backgroundMusicData !== undefined) {
      if (backgroundMusicData) {
        updateData.backgroundMusicData =
          typeof backgroundMusicData === "string"
            ? backgroundMusicData
            : JSON.stringify(backgroundMusicData);
        updateData.backgroundMusicUrl =
          backgroundMusicData.downloadUrl ||
          backgroundMusicData.audioUrl ||
          null;
        updateData.backgroundMusicFilename = backgroundMusicData.name
          ? `${backgroundMusicData.name} - ${
              backgroundMusicData.artist || "Unknown"
            }`
          : null;
      } else {
        updateData.backgroundMusicData = null;
        updateData.backgroundMusicUrl = null;
        updateData.backgroundMusicFilename = null;
      }
    }
    if (voiceConfigId !== undefined) {
      updateData.voiceConfigId = voiceConfigId || null;
    }

    // Обновляем статус на GENERATING_ASSETS сразу
    let progress = createProgress(
      "success",
      "success",
      "success",
      "pending",
      "waiting",
    );
    await updateVideoProgress(
      id,
      { ...updateData, status: "GENERATING_ASSETS" },
      progress,
    );

    // Сразу отвечаем клиенту
    res.json({
      success: true,
      message: "Approved. Audio generation and render started.",
      video: {
        id,
        status: "GENERATING_ASSETS",
        progress,
      },
    });

    // Запускаем асинхронную обработку
    processApproval(id, segments, voiceConfigId, video).catch((error) => {
      console.error("Background approval processing error:", error);
    });
  } catch (error) {
    console.error("Approve error:", error);
    res.status(500).json({
      error: "Approval failed",
      message: error.message,
    });
  }
});

/**
 * Асинхронная обработка после approve (аудио + рендер)
 */
async function processApproval(
  videoId,
  segments,
  voiceConfigId,
  originalVideo,
) {
  try {
    // Получаем настройки голоса
    let voiceConfig = null;
    if (voiceConfigId) {
      voiceConfig = await prisma.voiceConfig.findUnique({
        where: { id: voiceConfigId },
      });
    }
    if (!voiceConfig) {
      voiceConfig = await prisma.voiceConfig.findFirst({
        where: { isDefault: true },
      });
    }

    // Начинаем отслеживание генерации
    startGeneration(videoId);

    // Получаем старые сегменты для сравнения текста
    const oldSegments = originalVideo.segments
      ? typeof originalVideo.segments === "string"
        ? JSON.parse(originalVideo.segments)
        : originalVideo.segments
      : [];

    const oldSegmentsMap = new Map();
    oldSegments.forEach((seg, idx) => {
      const key =
        seg.type === "intro"
          ? "intro"
          : seg.type === "outro"
            ? "outro"
            : `segment_${seg.number || idx}`;
      oldSegmentsMap.set(key, seg);
    });

    // ========== ШАГ 4: Генерация аудио ==========
    console.log("Step 4: Generating audio for all segments...");

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Проверка остановки
      if (isGenerationAborted(videoId)) {
        cleanupGeneration(videoId);
        await updateVideoProgress(
          videoId,
          { status: "PENDING" },
          createProgress("success", "success", "success", "waiting", "waiting"),
        );
        console.log(`[Approve] Generation stopped by user for ${videoId}`);
        return;
      }

      const segmentKey =
        segment.type === "intro"
          ? "intro"
          : segment.type === "outro"
            ? "outro"
            : `segment_${segment.number || i}`;

      const oldSegment = oldSegmentsMap.get(segmentKey);
      const textChanged = !oldSegment || oldSegment.text !== segment.text;
      const hasExistingAudio = segment.audioPath && !textChanged;

      if (hasExistingAudio) {
        if (oldSegment) {
          if (!segments[i].audioDuration && oldSegment.audioDuration) {
            segments[i].audioDuration = oldSegment.audioDuration;
          }
          if (!segments[i].wordTimings && oldSegment.wordTimings) {
            segments[i].wordTimings = oldSegment.wordTimings;
          }
        }
        console.log(
          `[Audio] Segment ${i + 1}/${segments.length} (${segment.type}): text unchanged, reusing existing audio`,
        );
        continue;
      }

      // Удаляем старый аудио файл если текст изменился
      if (textChanged && oldSegment?.audioPath) {
        try {
          const oldAudioPath = path.join(
            __dirname,
            "../..",
            oldSegment.audioPath,
          );
          await fs.unlink(oldAudioPath);
          console.log(
            `[Audio] Deleted old audio file: ${oldSegment.audioPath}`,
          );
        } catch (err) {
          console.log(`[Audio] Could not delete old audio: ${err.message}`);
        }
      }

      console.log(
        `[Audio] Generating for segment ${i + 1}/${segments.length}: ${segment.type}`,
      );

      const segmentId =
        segment.type === "intro"
          ? `${videoId}_intro`
          : segment.type === "outro"
            ? `${videoId}_outro`
            : `${videoId}_segment_${segment.number || i}`;

      const audio = await generateAudio(segment.text, segmentId, voiceConfig);
      segments[i].audioPath = audio.path;
      segments[i].audioDuration = audio.duration;

      // Транскрибируем для таймингов слов
      try {
        const {
          transcribeWithTimings,
        } = require("../services/whisper.service");
        const fullAudioPath = path.join(__dirname, "../../", audio.path);
        const wordTimings = await transcribeWithTimings(fullAudioPath);
        segments[i].wordTimings = wordTimings;
        console.log(
          `[Whisper] Segment ${i + 1}: ${wordTimings.length} words with timings`,
        );
      } catch (err) {
        console.error(`[Whisper] Failed for segment ${i + 1}:`, err.message);
        segments[i].wordTimings = [];
      }
    }

    // ========== ШАГ 5: Рендер ==========
    console.log("Step 5: Auto-starting render...");

    // Проверка остановки перед рендером
    if (isGenerationAborted(videoId)) {
      cleanupGeneration(videoId);
      await updateVideoProgress(
        videoId,
        { status: "PENDING" },
        createProgress("success", "success", "success", "success", "waiting"),
      );
      console.log(`[Approve] Generation stopped before render for ${videoId}`);
      return;
    }

    // Обновляем статус на RENDERING
    let progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "pending",
    );
    await updateVideoProgress(
      videoId,
      { segments: JSON.stringify(segments), status: "RENDERING" },
      progress,
    );

    // Получаем обновленное видео для рендера
    const videoForRender = await prisma.video.findUnique({
      where: { id: videoId },
    });

    // Запускаем рендеринг
    const videoPath = await renderVideo({
      ...videoForRender,
      segments: segments,
    });

    // Успешно завершено
    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "success",
    );
    await updateVideoProgress(
      videoId,
      { videoPath, status: "COMPLETED" },
      progress,
    );

    cleanupGeneration(videoId);
    console.log(`[Approve] Completed successfully for ${videoId}`);
  } catch (error) {
    console.error("processApproval error:", error);

    const failedProgress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "failed",
    );
    try {
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: "FAILED",
          progress: JSON.stringify(failedProgress),
        },
      });
    } catch (e) {
      console.error("Failed to update video status to FAILED:", e);
    }

    cleanupGeneration(videoId);
  }
}

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
 * POST /topic-suggestions
 * Генерирует список тем для YouTube Shorts с помощью AI
 */
router.post("/topic-suggestions", async (req, res) => {
  try {
    const { category } = req.body;
    console.log(
      `[API] Generating topic suggestions for: "${category || "general"}"`,
    );

    const result = await generateTopicSuggestions(category);

    res.json({
      success: true,
      topics: result.topics,
    });
  } catch (error) {
    console.error("Error generating topic suggestions:", error);
    res.status(500).json({
      error: "Failed to generate topic suggestions",
      details: error.message,
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
 * Создает новую версию видео
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

    // Проверяем, есть ли уже отрендеренное видео (перерендер)
    const isRerender = !!video.videoPath;
    let savedVersionNumber = null;

    if (isRerender) {
      // Сохраняем СТАРОЕ видео как версию перед новым рендером
      const lastVersion = await prisma.videoVersion.findFirst({
        where: { videoId: id },
        orderBy: { version: "desc" },
      });
      const newVersionNumber = lastVersion ? lastVersion.version + 1 : 1;

      // Создаем путь для сохранения старой версии
      const versionedVideoPath = `storage/videos/${id}_v${newVersionNumber}.mp4`;
      const absoluteOldVideoPath = path.join(
        __dirname,
        "../..",
        video.videoPath,
      );
      const absoluteVersionedPath = path.join(
        __dirname,
        "../..",
        versionedVideoPath,
      );

      // Копируем старый файл в версию
      try {
        await fs.copyFile(absoluteOldVideoPath, absoluteVersionedPath);
        console.log(
          `Saved old video as version ${newVersionNumber}: ${versionedVideoPath}`,
        );

        // Деактивируем все предыдущие версии
        await prisma.videoVersion.updateMany({
          where: { videoId: id },
          data: { isActive: false },
        });

        // Создаем запись версии для СТАРОГО видео
        await prisma.videoVersion.create({
          data: {
            videoId: id,
            version: newVersionNumber,
            videoPath: versionedVideoPath,
            segments: video.segments,
            voiceConfigId: video.voiceConfigId,
            backgroundMusicFilename: video.backgroundMusicFilename,
            isActive: false, // Старая версия неактивна
          },
        });

        savedVersionNumber = newVersionNumber;
        console.log(
          `Created version ${newVersionNumber} from old video for ${id}`,
        );
      } catch (err) {
        console.error(`Failed to save old video as version:`, err);
      }
    }

    // Обновляем статус на RENDERING и прогресс
    progress = createProgress(
      "success",
      "success",
      "success",
      "success",
      "pending",
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
      "success",
    );
    const updatedVideo = await updateVideoProgress(
      id,
      {
        videoPath,
        status: "COMPLETED",
      },
      progress,
    );

    res.json({
      success: true,
      message: isRerender
        ? `Video re-rendered. Old version saved as v${savedVersionNumber}`
        : "Video rendered successfully",
      savedVersion: savedVersionNumber,
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
      "failed",
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
      include: {
        youtubeChannel: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
        _count: {
          select: { videoVersions: true },
        },
      },
    });

    // Парсим progress для каждого видео и добавляем versionsCount
    const videosWithParsedProgress = videos.map((video) => ({
      ...video,
      progress: video.progress ? JSON.parse(video.progress) : null,
      versionsCount: video._count?.videoVersions || 0,
      _count: undefined,
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
 * Удаляет видео по ID вместе со всеми связанными файлами
 */
router.delete("/videos/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Получаем видео и все его версии перед удалением
    const video = await prisma.video.findUnique({
      where: { id },
      include: { videoVersions: true },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Собираем все пути к файлам для удаления
    const filesToDelete = [];
    const storageDir = path.join(__dirname, "../../storage");

    // 1. Основное видео
    if (video.videoPath) {
      filesToDelete.push(path.join(__dirname, "../..", video.videoPath));
    }

    // 2. Аудио файлы (intro, outro, segments)
    const audioPatterns = [
      `${id}_intro.mp3`,
      `${id}_outro.mp3`,
      `${id}_segment_*.mp3`,
    ];

    try {
      const audioDir = path.join(storageDir, "audio");
      const audioFiles = await fs.readdir(audioDir);
      for (const file of audioFiles) {
        if (file.startsWith(id)) {
          filesToDelete.push(path.join(audioDir, file));
        }
      }
    } catch (err) {
      console.log("[Delete] No audio files found or error reading audio dir");
    }

    // 3. Все версии видео
    for (const version of video.videoVersions || []) {
      if (version.videoPath) {
        filesToDelete.push(path.join(__dirname, "../..", version.videoPath));
      }
    }

    // 4. Превью видео
    try {
      const previewDir = path.join(storageDir, "video-previews");
      const previewFiles = await fs.readdir(previewDir);
      for (const file of previewFiles) {
        if (file.startsWith(id)) {
          filesToDelete.push(path.join(previewDir, file));
        }
      }
    } catch (err) {
      // Папка может не существовать
    }

    // 5. Голосовые превью
    try {
      const voicePreviewDir = path.join(storageDir, "voice-previews");
      const voicePreviewFiles = await fs.readdir(voicePreviewDir);
      for (const file of voicePreviewFiles) {
        if (file.startsWith(id)) {
          filesToDelete.push(path.join(voicePreviewDir, file));
        }
      }
    } catch (err) {
      // Папка может не существовать
    }

    // Удаляем файлы
    let deletedFiles = 0;
    for (const filePath of filesToDelete) {
      try {
        await fs.unlink(filePath);
        deletedFiles++;
        console.log(`[Delete] Removed file: ${filePath}`);
      } catch (err) {
        // Файл может не существовать
      }
    }

    console.log(`[Delete] Removed ${deletedFiles} files for video ${id}`);

    // Удаляем версии из БД
    await prisma.videoVersion.deleteMany({
      where: { videoId: id },
    });

    // Удаляем видео из БД
    await prisma.video.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: "Video and all related files deleted",
      deletedFiles,
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
 * Body: { fromStep: 1-5, videoSource: 'pexels'|'pixabay'|'klipy' } - с какого шага начать
 * 1=скрипт, 2=поиск видео, 3=аудио, 4=обработка сегментов, 5=рендеринг
 */
router.post("/retry/:id", async (req, res) => {
  const { id } = req.params;
  const { fromStep, videoSource = "pexels" } = req.body;

  // Выбираем функции поиска в зависимости от источника
  let findVideosForSegments;
  let searchSingleVideo;

  if (videoSource === "pixabay") {
    findVideosForSegments = findVideosForSegmentsPixabay;
    searchSingleVideo = searchSingleVideoPixabay;
  } else if (videoSource === "klipy") {
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

  console.log(`[Retry] Using ${videoSource} for video search`);

  try {
    // Получаем видео из БД
    let video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Разрешаем retry для FAILED, COMPLETED, PENDING и AWAITING_REVIEW (для ручного перезапуска)
    const allowedStatuses = [
      "FAILED",
      "COMPLETED",
      "PENDING",
      "AWAITING_REVIEW",
    ];
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
        "waiting",
      );
      video = await updateVideoProgress(video.id, {}, progress);

      const topic =
        video.title !== "Generating..." ? video.title : "Интересные факты";
      const aiResult = await generateScript(topic);

      // Формируем сегменты с intro и outro (так же как при первой генерации)
      segments = [
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

      // Сохраняем tags и hashtags
      const tags = aiResult.tags || ["shorts", "факты", "интересное"];
      const hashtags = aiResult.hashtags || ["#interesting", "#интересное"];

      progress = createProgress(
        "success",
        "pending",
        "waiting",
        "waiting",
        "waiting",
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
        progress,
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
          "waiting",
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Получаем сегменты для поиска (только те что без stockVideo)
      const segmentsToSearch = segments.filter(
        (s) => !s.stockVideo && s.searchKeywords,
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
        "waiting",
      );

      // Если начали с шага 1 или 2, останавливаемся на AWAITING_REVIEW для проверки
      if (step <= 2) {
        video = await updateVideoProgress(
          video.id,
          {
            segments: JSON.stringify(segments),
            status: "AWAITING_REVIEW",
          },
          progress,
        );

        return res.json({
          success: true,
          message: "Ready for review. Please check text and video backgrounds.",
          awaitingReview: true,
          video: {
            ...video,
            progress: JSON.parse(video.progress),
            segments: JSON.parse(video.segments),
          },
        });
      }

      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
        },
        progress,
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
          "waiting",
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Генерируем аудио только для сегментов без аудио
      const factSegments = segments.filter(
        (s) => s.type !== "intro" && s.type !== "outro",
      );
      const segmentsWithAudio = await generateSegmentsAudio(
        factSegments.filter((s) => !s.audioPath),
        video.id,
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
        "waiting",
      );
      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
        },
        progress,
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
          "waiting",
        );
        video = await updateVideoProgress(video.id, {}, progress);
      }

      // Проверяем наличие intro/outro
      const hasIntro = segments.some((s) => s.type === "intro");
      const hasOutro = segments.some((s) => s.type === "outro");

      if (!hasIntro) {
        const introAudio = await generateAudio(
          "Привет! Смотри интересные факты!",
          `${video.id}_intro`,
        );
        segments.unshift({
          type: "intro",
          text: "Привет!",
          audioPath: introAudio.path,
          audioDuration: introAudio.duration,
        });
      }

      if (!hasOutro) {
        const outroAudio = await generateAudio(
          "Подпишись на канал!",
          `${video.id}_outro`,
        );
        segments.push({
          type: "outro",
          text: "Подпишись!",
          audioPath: outroAudio.path,
          audioDuration: outroAudio.duration,
        });
      }

      progress = createProgress(
        "success",
        "success",
        "success",
        "success",
        "waiting",
      );
      video = await updateVideoProgress(
        video.id,
        {
          segments: JSON.stringify(segments),
          status: "PENDING",
        },
        progress,
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
        "pending",
      );
      video = await updateVideoProgress(
        video.id,
        { status: "RENDERING" },
        progress,
      );

      const videoPath = await renderVideo(video);

      // Создаём новую версию видео
      const lastVersion = await prisma.videoVersion.findFirst({
        where: { videoId: id },
        orderBy: { version: "desc" },
      });
      const newVersionNumber = lastVersion ? lastVersion.version + 1 : 1;

      // Создаем уникальный путь для версии
      const versionedVideoPath = `storage/videos/${id}_v${newVersionNumber}.mp4`;
      const absoluteVideoPath = path.join(__dirname, "../..", videoPath);
      const absoluteVersionedPath = path.join(
        __dirname,
        "../..",
        versionedVideoPath,
      );

      // Копируем файл с новым именем для версии
      await fs.copyFile(absoluteVideoPath, absoluteVersionedPath);
      console.log(
        `[Retry] Copied video to versioned path: ${versionedVideoPath}`,
      );

      // Деактивируем все предыдущие версии
      await prisma.videoVersion.updateMany({
        where: { videoId: id },
        data: { isActive: false },
      });

      // Создаем новую версию с уникальным путём
      await prisma.videoVersion.create({
        data: {
          videoId: id,
          version: newVersionNumber,
          videoPath: versionedVideoPath,
          segments: JSON.stringify(segments),
          voiceConfigId: video.voiceConfigId,
          backgroundMusicFilename: video.backgroundMusicFilename,
          isActive: true,
        },
      });

      console.log(
        `[Retry] Created video version ${newVersionNumber} for video ${id}`,
      );

      progress = createProgress(
        "success",
        "success",
        "success",
        "success",
        "success",
      );
      video = await updateVideoProgress(
        video.id,
        {
          videoPath,
          status: "COMPLETED",
        },
        progress,
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
        `[Pixabay Search] Query: ${keywords[0]}, Page: ${pageNum}, VerticalOnly: ${isVerticalOnly}`,
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
        } videos, total: ${totalHits}`,
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
        `[Pixabay Search] Final videos: ${videos.length}, hasMore: ${hasMore}`,
      );
    } else if (source === "klipy") {
      // Klipy API для клипов (cursor-based pagination)
      const { searchClips } = require("../services/klipy.service");

      console.log(
        `[Klipy Search] Query: ${keywords[0]}, Page: ${pageNum}, Pos: ${
          pos || "none"
        }`,
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
        `[Pexels Search] Query: ${keywords[0]}, Page: ${pageNum}, VerticalOnly: ${isVerticalOnly}`,
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
 * Теперь также принимает voiceConfigId и backgroundMusicData для перерендера с новыми настройками
 */
router.patch("/videos/:id/segments", async (req, res) => {
  const { id } = req.params;
  const { segments, voiceConfigId, backgroundMusicData, regenerateAudio } =
    req.body;

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

    // Подготавливаем данные для обновления
    const updateData = {
      segments: JSON.stringify(segments),
    };

    // Обрабатываем backgroundMusicData
    if (backgroundMusicData !== undefined) {
      if (backgroundMusicData) {
        updateData.backgroundMusicData =
          typeof backgroundMusicData === "string"
            ? backgroundMusicData
            : JSON.stringify(backgroundMusicData);
        updateData.backgroundMusicUrl =
          backgroundMusicData.downloadUrl ||
          backgroundMusicData.audioUrl ||
          null;
        updateData.backgroundMusicFilename = backgroundMusicData.name
          ? `${backgroundMusicData.name} - ${
              backgroundMusicData.artist || "Unknown"
            }`
          : null;
      } else {
        updateData.backgroundMusicData = null;
        updateData.backgroundMusicUrl = null;
        updateData.backgroundMusicFilename = null;
      }
    }

    // Если нужно перегенерировать аудио (изменился голос)
    if (regenerateAudio) {
      updateData.status = "GENERATING_ASSETS";
      if (voiceConfigId !== undefined) {
        updateData.voiceConfigId = voiceConfigId || null;
      }
    } else {
      updateData.status = "PENDING"; // Только перерендер видео
    }

    // Обновляем видео
    const updatedVideo = await prisma.video.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      message: "Segments updated successfully",
      regenerateAudio: !!regenerateAudio,
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
// VIDEO REGENERATION & VERSIONING
// ============================================================

/**
 * POST /videos/:id/regenerate
 * Полная перегенерация видео с новыми настройками (голос, музыка)
 * Создает новую версию видео после рендера
 */
router.post("/videos/:id/regenerate", async (req, res) => {
  const { id } = req.params;
  const {
    segments: inputSegments,
    voiceConfigId,
    backgroundMusicData,
    templateId,
  } = req.body;

  try {
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    console.log(`[Regenerate] Starting regeneration for video ${id}`);
    console.log(
      `[Regenerate] voiceConfigId: ${voiceConfigId}, backgroundMusicData: ${
        backgroundMusicData ? "provided" : "none"
      }`,
    );

    // Получаем конфиг голоса если указан
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

    // Подготавливаем сегменты
    let segments = inputSegments
      ? typeof inputSegments === "string"
        ? JSON.parse(inputSegments)
        : inputSegments
      : typeof video.segments === "string"
        ? JSON.parse(video.segments)
        : video.segments;

    // Подготавливаем данные для обновления
    const updateData = {
      status: "GENERATING_ASSETS",
      voiceConfigId: voiceConfigId || null,
    };

    // Добавляем templateId если передан
    if (templateId !== undefined) {
      updateData.templateId = templateId || null;
    }

    // Обрабатываем backgroundMusicData
    if (backgroundMusicData !== undefined) {
      if (backgroundMusicData) {
        updateData.backgroundMusicData =
          typeof backgroundMusicData === "string"
            ? backgroundMusicData
            : JSON.stringify(backgroundMusicData);
        updateData.backgroundMusicUrl =
          backgroundMusicData.downloadUrl ||
          backgroundMusicData.audioUrl ||
          null;
        updateData.backgroundMusicFilename = backgroundMusicData.name
          ? `${backgroundMusicData.name} - ${
              backgroundMusicData.artist || "Unknown"
            }`
          : null;
      } else {
        updateData.backgroundMusicData = null;
        updateData.backgroundMusicUrl = null;
        updateData.backgroundMusicFilename = null;
      }
    }

    // Обновляем видео статус на генерацию
    let progress = createProgress(
      "success",
      "success",
      "success",
      "pending",
      "waiting",
    );
    await updateVideoProgress(id, updateData, progress);

    // Отправляем ответ сразу
    res.json({
      success: true,
      message: "Regeneration started",
    });

    // Запускаем генерацию аудио асинхронно
    (async () => {
      try {
        // Генерируем аудио для каждого сегмента
        for (let i = 0; i < segments.length; i++) {
          const segment = segments[i];
          console.log(
            `[Regenerate] Audio ${i + 1}/${segments.length}: ${
              segment.type || "content"
            }`,
          );

          const segmentId =
            segment.type === "intro"
              ? `${id}_intro`
              : segment.type === "outro"
                ? `${id}_outro`
                : `${id}_segment_${segment.number || i}`;

          // Передаём настройки голоса в generateAudio
          const audio = await generateAudio(
            segment.text,
            segmentId,
            voiceConfig,
          );
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
              `[Regenerate] Whisper ${i + 1}: ${wordTimings.length} words`,
            );
          } catch (err) {
            console.error(
              `[Regenerate] Whisper failed for ${i + 1}:`,
              err.message,
            );
            segments[i].wordTimings = [];
          }
        }

        // Аудио готово, устанавливаем статус PENDING для рендера
        progress = createProgress(
          "success",
          "success",
          "success",
          "success",
          "waiting",
        );
        await updateVideoProgress(
          id,
          {
            segments: JSON.stringify(segments),
            status: "PENDING",
          },
          progress,
        );

        console.log(`[Regenerate] Audio generation complete, ready for render`);
      } catch (error) {
        console.error(`[Regenerate] Error:`, error);
        const failedProgress = createProgress(
          "success",
          "success",
          "success",
          "failed",
          "waiting",
        );
        await prisma.video.update({
          where: { id },
          data: {
            status: "FAILED",
            progress: JSON.stringify(failedProgress),
          },
        });
      }
    })();
  } catch (error) {
    console.error("Error starting regeneration:", error);
    res.status(500).json({
      error: "Failed to start regeneration",
      message: error.message,
    });
  }
});

/**
 * GET /videos/:id/versions
 * Получение всех версий видео
 */
router.get("/videos/:id/versions", async (req, res) => {
  const { id } = req.params;

  try {
    const versions = await prisma.videoVersion.findMany({
      where: { videoId: id },
      orderBy: { version: "desc" },
      include: {
        voiceConfig: true,
      },
    });

    res.json(versions);
  } catch (error) {
    console.error("Error fetching video versions:", error);
    res.status(500).json({
      error: "Failed to fetch video versions",
      message: error.message,
    });
  }
});

/**
 * POST /videos/:id/versions/:version/activate
 * Активирует указанную версию видео
 */
router.post("/videos/:id/versions/:version/activate", async (req, res) => {
  const { id, version } = req.params;

  try {
    const versionRecord = await prisma.videoVersion.findUnique({
      where: {
        videoId_version: {
          videoId: id,
          version: parseInt(version),
        },
      },
    });

    if (!versionRecord) {
      return res.status(404).json({ error: "Version not found" });
    }

    // Деактивируем все версии
    await prisma.videoVersion.updateMany({
      where: { videoId: id },
      data: { isActive: false },
    });

    // Активируем выбранную версию
    await prisma.videoVersion.update({
      where: {
        videoId_version: {
          videoId: id,
          version: parseInt(version),
        },
      },
      data: { isActive: true },
    });

    // Обновляем путь к видео в основной записи
    await prisma.video.update({
      where: { id },
      data: {
        videoPath: versionRecord.videoPath,
        segments: versionRecord.segments,
        voiceConfigId: versionRecord.voiceConfigId,
        backgroundMusicFilename: versionRecord.backgroundMusicFilename,
      },
    });

    res.json({
      success: true,
      message: `Version ${version} activated`,
    });
  } catch (error) {
    console.error("Error activating version:", error);
    res.status(500).json({
      error: "Failed to activate version",
      message: error.message,
    });
  }
});

module.exports = router;
