const { exec } = require("child_process");
const path = require("path");
const fs = require("fs").promises;
const prisma = require("./db.service");

const VIDEOS_DIR = path.join(__dirname, "../../storage/videos");
const FRONT_RENDER_DIR = path.join(__dirname, "../../../front-render");

/**
 * Преобразует template из БД в формат для Remotion
 */
function formatTemplateForRemotion(template, backendUrl) {
  if (!template) return null;

  // Парсим ctaItems
  let ctaItems = [];
  try {
    ctaItems =
      typeof template.ctaItems === "string"
        ? JSON.parse(template.ctaItems)
        : template.ctaItems || [];
  } catch (e) {
    console.error("[Render] Failed to parse ctaItems:", e);
  }

  // Преобразуем пути к изображениям в полные URL
  ctaItems = ctaItems.map((item) => ({
    ...item,
    imagePath: item.imagePath ? `${backendUrl}/${item.imagePath}` : null,
  }));

  // Преобразуем overlays (включая appearanceConfig для фильтрации по типу сегмента)
  const overlays = (template.overlays || []).map((overlay) => {
    // Парсим appearanceConfig
    let appearanceConfig = {
      intro: { show: false },
      segments: { show: true },
      outro: { show: false },
    };
    try {
      if (overlay.appearanceConfig) {
        appearanceConfig =
          typeof overlay.appearanceConfig === "string"
            ? JSON.parse(overlay.appearanceConfig)
            : overlay.appearanceConfig;
      }
    } catch (e) {
      console.error("[Render] Failed to parse appearanceConfig:", e);
    }

    return {
      id: overlay.id,
      imagePath: `${backendUrl}/${overlay.imagePath}`,
      positionX: overlay.positionX,
      positionY: overlay.positionY,
      anchor: overlay.anchor,
      width: overlay.width,
      opacity: overlay.opacity,
      order: overlay.order,
      appearanceConfig,
    };
  });

  return {
    // Цвета
    primaryColor: template.primaryColor,
    backgroundColor: template.backgroundColor,

    // Субтитры
    subtitleMode: template.subtitleMode,
    subtitlePositionX: template.subtitlePositionX,
    subtitlePositionY: template.subtitlePositionY,
    subtitleWidth: template.subtitleWidth,
    subtitleFontFamily: template.subtitleFontFamily,
    subtitleFontWeight: template.subtitleFontWeight,
    subtitleFontSize: template.subtitleFontSize,
    subtitleFontColor: template.subtitleFontColor,
    subtitleHighlightColor: template.subtitleHighlightColor,
    subtitleStrokeEnabled: template.subtitleStrokeEnabled,
    subtitleStrokeColor: template.subtitleStrokeColor,
    subtitleStrokeWidth: template.subtitleStrokeWidth,
    subtitleBgColor: template.subtitleBgColor,
    subtitleBgEnabled: template.subtitleBgEnabled,

    // Нумерация
    showNumbers: template.showNumbers,
    numberPositionX: template.numberPositionX,
    numberPositionY: template.numberPositionY,
    numberAnchor: template.numberAnchor,
    numberStyle: template.numberStyle,
    numberBgColor: template.numberBgColor,
    numberFontColor: template.numberFontColor,
    numberFontSize: template.numberFontSize,
    numberTemplate: template.numberTemplate,
    numberDirection: template.numberDirection,

    // Прогресс-бар
    showProgressBar: template.showProgressBar,
    progressBarPosition: template.progressBarPosition,
    progressBarColor: template.progressBarColor,
    progressBarHeight: template.progressBarHeight,

    // CTA
    showCTA: template.showCTA,
    ctaPositionX: template.ctaPositionX,
    ctaPositionY: template.ctaPositionY,
    ctaAnchor: template.ctaAnchor,
    ctaDirection: template.ctaDirection,
    ctaGap: template.ctaGap,
    ctaItems,

    // Оверлеи
    overlays,
  };
}

/**
 * Запускает рендеринг видео через Remotion CLI
 * @param {object} video - Объект видео из БД
 * @param {string} video.id - ID видео
 * @param {string} video.title - Заголовок видео
 * @param {string} video.scriptText - Текст сценария
 * @param {string} video.segments - JSON строка с сегментами
 * @param {string} video.templateId - ID шаблона внешнего вида
 * @param {string} video.backgroundMusicUrl - URL фоновой музыки (Jamendo)
 * @param {string} video.backgroundMusicData - JSON с полными данными трека
 * @returns {Promise<string>} - Путь к созданному видео файлу
 */
async function renderVideo(video) {
  const {
    id,
    title,
    scriptText,
    segments: segmentsJson,
    templateId,
    backgroundMusicUrl,
    backgroundMusicData,
  } = video;
  const outputFilename = `${id}.mp4`;
  const outputPath = path.join(VIDEOS_DIR, outputFilename);

  // Убедимся, что директория существует
  await fs.mkdir(VIDEOS_DIR, { recursive: true });

  // Парсим сегменты (могут прийти как строка или как массив)
  const segments = segmentsJson
    ? typeof segmentsJson === "string"
      ? JSON.parse(segmentsJson)
      : segmentsJson
    : [];

  // Backend URL для формирования HTTP ссылок
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

  // Загружаем шаблон если указан
  let template = null;
  if (templateId) {
    try {
      const dbTemplate = await prisma.videoTemplate.findUnique({
        where: { id: templateId },
        include: { overlays: true },
      });
      template = formatTemplateForRemotion(dbTemplate, backendUrl);
      console.log(`[Render] Using template: ${dbTemplate?.name || templateId}`);
      console.log(`[Render] Template settings:`, {
        backgroundColor: template?.backgroundColor,
        subtitleFontSize: template?.subtitleFontSize,
        subtitleFontWeight: template?.subtitleFontWeight,
        showNumbers: template?.showNumbers,
        numberPositionX: template?.numberPositionX,
        numberPositionY: template?.numberPositionY,
      });
    } catch (e) {
      console.error("[Render] Failed to load template:", e);
    }
  }

  // Преобразуем пути к аудио в HTTP URLs
  const segmentsWithUrls = segments.map((segment) => ({
    ...segment,
    audioUrl: segment.audioPath ? `${backendUrl}/${segment.audioPath}` : null,
  }));

  // Определяем URL фоновой музыки
  // Приоритет: backgroundMusicData.downloadUrl > backgroundMusicUrl
  let finalBackgroundMusicUrl = null;

  if (backgroundMusicData) {
    try {
      const musicData =
        typeof backgroundMusicData === "string"
          ? JSON.parse(backgroundMusicData)
          : backgroundMusicData;
      // Используем downloadUrl (полный файл), audioUrl (stream) или url (старый формат)
      finalBackgroundMusicUrl =
        musicData.downloadUrl || musicData.audioUrl || musicData.url || null;
    } catch (e) {
      console.error("[Render] Failed to parse backgroundMusicData:", e);
    }
  }

  // Fallback на backgroundMusicUrl если data не работает
  if (!finalBackgroundMusicUrl && backgroundMusicUrl) {
    finalBackgroundMusicUrl = backgroundMusicUrl;
  }

  console.log(
    `[Render] Background music: ${finalBackgroundMusicUrl || "none"}`,
  );

  // Подготовка props для Remotion (с глобальной фоновой музыкой и шаблоном)
  const propsObj = {
    title,
    scriptText: scriptText,
    segments: segmentsWithUrls,
    backgroundMusicUrl: finalBackgroundMusicUrl,
  };

  // Добавляем шаблон если есть
  if (template) {
    propsObj.template = template;
    // Используем primaryColor из шаблона как themeColor
    propsObj.themeColor = template.primaryColor;
  }

  const props = JSON.stringify(propsObj);

  // DEBUG: Логируем что передаем в Remotion
  console.log(
    "[Render] Props for Remotion:",
    JSON.stringify(
      {
        hasTemplate: !!template,
        templateShowNumbers: template?.showNumbers,
        templateNumberPositionX: template?.numberPositionX,
        templateNumberPositionY: template?.numberPositionY,
        segmentsCount: segmentsWithUrls.length,
        segmentTypes: segmentsWithUrls.map((s) => ({
          type: s.type,
          number: s.number,
        })),
      },
      null,
      2,
    ),
  );

  // Экранируем props для shell
  const escapedProps = props.replace(/'/g, "'\\''");

  // Формируем команду для Remotion CLI
  // Используем SegmentVideo композицию для нового формата
  const composition = segments.length > 0 ? "SegmentVideo" : "MainVideo";
  const command = `cd "${FRONT_RENDER_DIR}" && npx remotion render src/index.ts ${composition} "${outputPath}" --props='${escapedProps}'`;

  console.log("Executing render command:", command);
  console.log("Segments count:", segments.length);
  if (template) {
    console.log("[Render] Template settings applied");
  }

  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) {
        console.error("Render error:", error);
        console.error("Stderr:", stderr);
        reject(new Error(`Render failed: ${error.message}`));
        return;
      }

      console.log("Render stdout:", stdout);

      if (stderr) {
        console.log("Render stderr:", stderr);
      }

      // Возвращаем относительный путь для хранения в БД
      resolve(`storage/videos/${outputFilename}`);
    });
  });
}

/**
 * Проверяет, установлен ли Remotion в front-render
 * @returns {Promise<boolean>}
 */
async function checkRemotionInstalled() {
  try {
    await fs.access(path.join(FRONT_RENDER_DIR, "node_modules", "@remotion"));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  renderVideo,
  checkRemotionInstalled,
};
