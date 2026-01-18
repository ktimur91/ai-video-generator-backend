const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const prisma = require("../services/db.service");

const router = express.Router();

// Настройка загрузки файлов для overlays
const OVERLAYS_DIR = path.join(__dirname, "../../storage/overlays");
const CTA_ICONS_DIR = path.join(__dirname, "../../storage/cta-icons");

const overlayStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(OVERLAYS_DIR, { recursive: true });
    cb(null, OVERLAYS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `overlay-${uniqueSuffix}${ext}`);
  },
});

const ctaIconStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(CTA_ICONS_DIR, { recursive: true });
    cb(null, CTA_ICONS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `cta-icon-${uniqueSuffix}${ext}`);
  },
});

const imageFilter = (req, file, cb) => {
  const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only PNG, JPEG, GIF and WebP images are allowed"));
  }
};

const upload = multer({
  storage: overlayStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
});

const uploadCtaIcon = multer({
  storage: ctaIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB for icons
  fileFilter: imageFilter,
});

// Хелпер для парсинга JSON полей шаблона
function parseTemplate(template) {
  if (!template) return null;
  return {
    ...template,
    ctaItems: JSON.parse(template.ctaItems || "[]"),
    overlays:
      template.overlays?.map((o) => ({
        ...o,
        appearanceConfig: JSON.parse(o.appearanceConfig || "{}"),
      })) || [],
  };
}

// ============================================================
// FONTS & ANIMATIONS (Справочники)
// ============================================================

/**
 * GET /templates/fonts/list
 * Получить список доступных шрифтов
 */
router.get("/fonts/list", async (req, res) => {
  const fonts = [
    { family: "Inter", weights: ["400", "500", "600", "700", "800", "900"] },
    { family: "Roboto", weights: ["400", "500", "700", "900"] },
    { family: "Open Sans", weights: ["400", "600", "700", "800"] },
    {
      family: "Montserrat",
      weights: ["400", "500", "600", "700", "800", "900"],
    },
    { family: "Oswald", weights: ["400", "500", "600", "700"] },
    { family: "Russo One", weights: ["400"] },
    { family: "Bebas Neue", weights: ["400"] },
    { family: "Comfortaa", weights: ["400", "500", "600", "700"] },
    { family: "Nunito", weights: ["400", "600", "700", "800", "900"] },
    { family: "Rubik", weights: ["400", "500", "600", "700", "800", "900"] },
  ];
  res.json({ fonts });
});

/**
 * GET /templates/animations/list
 * Получить список доступных анимаций
 */
router.get("/animations/list", async (req, res) => {
  const animations = [
    { id: "fadeIn", name: "Появление" },
    { id: "fadeOut", name: "Исчезновение" },
    { id: "slideInLeft", name: "Выезд слева" },
    { id: "slideInRight", name: "Выезд справа" },
    { id: "slideInTop", name: "Выезд сверху" },
    { id: "slideInBottom", name: "Выезд снизу" },
    { id: "zoomIn", name: "Увеличение" },
    { id: "zoomOut", name: "Уменьшение" },
    { id: "bounce", name: "Прыжок" },
    { id: "pulse", name: "Пульсация" },
  ];
  res.json({ animations });
});

/**
 * POST /templates/cta-icon
 * Загрузить иконку для CTA элемента
 */
router.post("/cta-icon", uploadCtaIcon.single("icon"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Icon file is required" });
    }

    const imagePath = `storage/cta-icons/${req.file.filename}`;
    res.json({
      success: true,
      path: imagePath,
      url: `/${imagePath}`,
    });
  } catch (error) {
    console.error("[Templates] Failed to upload CTA icon:", error);
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: "Failed to upload CTA icon" });
  }
});

/**
 * DELETE /templates/cta-icon
 * Удалить иконку CTA
 */
router.delete("/cta-icon", async (req, res) => {
  try {
    const { imagePath } = req.body;
    if (!imagePath) {
      return res.status(400).json({ error: "imagePath is required" });
    }

    const filePath = path.join(__dirname, "../..", imagePath);
    await fs.unlink(filePath).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error("[Templates] Failed to delete CTA icon:", error);
    res.status(500).json({ error: "Failed to delete CTA icon" });
  }
});

// ============================================================
// TEMPLATES CRUD
// ============================================================

/**
 * GET /templates
 * Получить все шаблоны
 */
router.get("/", async (req, res) => {
  try {
    const templates = await prisma.videoTemplate.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      include: {
        channel: {
          select: { id: true, title: true, thumbnail: true },
        },
        overlays: {
          orderBy: { zIndex: "asc" },
        },
      },
    });

    res.json({ templates: templates.map(parseTemplate) });
  } catch (error) {
    console.error("[Templates] Failed to get templates:", error);
    res.status(500).json({ error: "Failed to get templates" });
  }
});

/**
 * GET /templates/:id
 * Получить шаблон по ID
 */
router.get("/:id", async (req, res) => {
  try {
    const template = await prisma.videoTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        channel: {
          select: { id: true, title: true, thumbnail: true },
        },
        overlays: {
          orderBy: { zIndex: "asc" },
        },
      },
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json({ template: parseTemplate(template) });
  } catch (error) {
    console.error("[Templates] Failed to get template:", error);
    res.status(500).json({ error: "Failed to get template" });
  }
});

/**
 * POST /templates
 * Создать новый шаблон
 */
router.post("/", async (req, res) => {
  try {
    const { name, channelId, isDefault, ctaItems, ...data } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Template name is required" });
    }

    // Если устанавливаем этот шаблон по умолчанию, снимаем флаг с других
    if (isDefault) {
      await prisma.videoTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    // Сериализуем ctaItems
    const serializedCtaItems = Array.isArray(ctaItems)
      ? JSON.stringify(ctaItems)
      : ctaItems || "[]";

    const template = await prisma.videoTemplate.create({
      data: {
        name,
        channelId: channelId || null,
        isDefault: isDefault || false,
        ctaItems: serializedCtaItems,
        ...data,
      },
      include: {
        channel: { select: { id: true, title: true, thumbnail: true } },
        overlays: { orderBy: { zIndex: "asc" } },
      },
    });

    res.json({ template: parseTemplate(template) });
  } catch (error) {
    console.error("[Templates] Failed to create template:", error);
    res.status(500).json({ error: "Failed to create template" });
  }
});

/**
 * PUT /templates/:id
 * Обновить шаблон
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Проверяем существование
    const existing = await prisma.videoTemplate.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Template not found" });
    }

    // Если устанавливаем этот шаблон по умолчанию, снимаем флаг с других
    if (updateData.isDefault) {
      await prisma.videoTemplate.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    // Сериализуем ctaItems если передан как массив
    if (updateData.ctaItems && Array.isArray(updateData.ctaItems)) {
      updateData.ctaItems = JSON.stringify(updateData.ctaItems);
    }

    // Убираем поля которые не нужно обновлять напрямую
    delete updateData.overlays;
    delete updateData.channel;
    delete updateData.videos;
    delete updateData.createdAt;
    delete updateData.updatedAt;

    const template = await prisma.videoTemplate.update({
      where: { id },
      data: updateData,
      include: {
        channel: { select: { id: true, title: true, thumbnail: true } },
        overlays: { orderBy: { zIndex: "asc" } },
      },
    });

    res.json({ template: parseTemplate(template) });
  } catch (error) {
    console.error("[Templates] Failed to update template:", error);
    res.status(500).json({ error: "Failed to update template" });
  }
});

/**
 * DELETE /templates/:id
 * Удалить шаблон
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Получаем шаблон с оверлеями для удаления файлов
    const template = await prisma.videoTemplate.findUnique({
      where: { id },
      include: { overlays: true },
    });

    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    // Удаляем файлы оверлеев
    for (const overlay of template.overlays) {
      try {
        const filePath = path.join(__dirname, "../..", overlay.imagePath);
        await fs.unlink(filePath);
      } catch (err) {
        console.log(
          `[Templates] Could not delete overlay file: ${err.message}`,
        );
      }
    }

    // Удаляем шаблон (каскадно удалит overlays)
    await prisma.videoTemplate.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error("[Templates] Failed to delete template:", error);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

/**
 * PUT /templates/:id/default
 * Установить шаблон по умолчанию
 */
router.put("/:id/default", async (req, res) => {
  try {
    const { id } = req.params;

    // Снимаем флаг со всех
    await prisma.videoTemplate.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });

    // Устанавливаем для выбранного
    const template = await prisma.videoTemplate.update({
      where: { id },
      data: { isDefault: true },
      include: {
        channel: { select: { id: true, title: true, thumbnail: true } },
        overlays: { orderBy: { zIndex: "asc" } },
      },
    });

    res.json({ template: parseTemplate(template) });
  } catch (error) {
    console.error("[Templates] Failed to set default template:", error);
    res.status(500).json({ error: "Failed to set default template" });
  }
});

// ============================================================
// OVERLAYS CRUD
// ============================================================

/**
 * POST /templates/:id/overlays
 * Добавить оверлей к шаблону
 */
router.post("/:id/overlays", upload.single("image"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      positionX,
      positionY,
      positionPreset,
      width,
      height,
      keepAspectRatio,
      rotation,
      opacity,
      zIndex,
      appearanceConfig,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    // Проверяем существование шаблона
    const template = await prisma.videoTemplate.findUnique({ where: { id } });
    if (!template) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Template not found" });
    }

    // Определяем zIndex - если не передан, ставим максимальный + 1
    let finalZIndex = parseInt(zIndex) || 10;
    if (!zIndex) {
      const maxZIndex = await prisma.templateOverlay.findFirst({
        where: { templateId: id },
        orderBy: { zIndex: "desc" },
        select: { zIndex: true },
      });
      finalZIndex = (maxZIndex?.zIndex || 0) + 1;
    }

    // Парсим или создаём дефолтный appearanceConfig
    const defaultAppearance = {
      intro: { show: false, animation: null },
      segments: { show: true, animation: null },
      outro: { show: false, animation: null },
    };

    let parsedAppearance = defaultAppearance;
    if (appearanceConfig) {
      try {
        parsedAppearance =
          typeof appearanceConfig === "string"
            ? JSON.parse(appearanceConfig)
            : appearanceConfig;
      } catch {
        parsedAppearance = defaultAppearance;
      }
    }

    const overlay = await prisma.templateOverlay.create({
      data: {
        templateId: id,
        name: name || req.file.originalname,
        imagePath: `storage/overlays/${req.file.filename}`,
        positionX: parseFloat(positionX) || 50,
        positionY: parseFloat(positionY) || 50,
        positionPreset: positionPreset || null,
        width: parseFloat(width) || 20,
        height: height ? parseFloat(height) : null,
        keepAspectRatio:
          keepAspectRatio !== "false" && keepAspectRatio !== false,
        rotation: parseFloat(rotation) || 0,
        opacity: parseFloat(opacity) || 1,
        zIndex: finalZIndex,
        appearanceConfig: JSON.stringify(parsedAppearance),
      },
    });

    res.json({
      overlay: {
        ...overlay,
        appearanceConfig: JSON.parse(overlay.appearanceConfig),
      },
    });
  } catch (error) {
    console.error("[Templates] Failed to create overlay:", error);
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: "Failed to create overlay" });
  }
});

/**
 * PUT /templates/:templateId/overlays/:overlayId
 * Обновить оверлей
 */
router.put("/:templateId/overlays/:overlayId", async (req, res) => {
  try {
    const { overlayId } = req.params;
    const updateData = { ...req.body };

    // Конвертируем числовые поля
    if (updateData.positionX !== undefined)
      updateData.positionX = parseFloat(updateData.positionX);
    if (updateData.positionY !== undefined)
      updateData.positionY = parseFloat(updateData.positionY);
    if (updateData.width !== undefined)
      updateData.width = parseFloat(updateData.width);
    if (updateData.height !== undefined)
      updateData.height = updateData.height
        ? parseFloat(updateData.height)
        : null;
    if (updateData.rotation !== undefined)
      updateData.rotation = parseFloat(updateData.rotation);
    if (updateData.opacity !== undefined)
      updateData.opacity = parseFloat(updateData.opacity);
    if (updateData.zIndex !== undefined)
      updateData.zIndex = parseInt(updateData.zIndex);

    // Сериализуем appearanceConfig если передан как объект
    if (
      updateData.appearanceConfig &&
      typeof updateData.appearanceConfig === "object"
    ) {
      updateData.appearanceConfig = JSON.stringify(updateData.appearanceConfig);
    }

    const overlay = await prisma.templateOverlay.update({
      where: { id: overlayId },
      data: updateData,
    });

    res.json({
      overlay: {
        ...overlay,
        appearanceConfig: JSON.parse(overlay.appearanceConfig),
      },
    });
  } catch (error) {
    console.error("[Templates] Failed to update overlay:", error);
    res.status(500).json({ error: "Failed to update overlay" });
  }
});

/**
 * PUT /templates/:templateId/overlays/reorder
 * Изменить порядок слоёв оверлеев
 */
router.put("/:templateId/overlays/reorder", async (req, res) => {
  try {
    const { templateId } = req.params;
    const { order } = req.body; // массив [{id, zIndex}, ...]

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: "Order must be an array" });
    }

    // Обновляем zIndex для каждого оверлея
    await Promise.all(
      order.map(({ id, zIndex }) =>
        prisma.templateOverlay.update({
          where: { id },
          data: { zIndex },
        }),
      ),
    );

    // Возвращаем обновлённый список
    const overlays = await prisma.templateOverlay.findMany({
      where: { templateId },
      orderBy: { zIndex: "asc" },
    });

    res.json({
      overlays: overlays.map((o) => ({
        ...o,
        appearanceConfig: JSON.parse(o.appearanceConfig),
      })),
    });
  } catch (error) {
    console.error("[Templates] Failed to reorder overlays:", error);
    res.status(500).json({ error: "Failed to reorder overlays" });
  }
});

/**
 * DELETE /templates/:templateId/overlays/:overlayId
 * Удалить оверлей
 */
router.delete("/:templateId/overlays/:overlayId", async (req, res) => {
  try {
    const { overlayId } = req.params;

    const overlay = await prisma.templateOverlay.findUnique({
      where: { id: overlayId },
    });

    if (!overlay) {
      return res.status(404).json({ error: "Overlay not found" });
    }

    // Удаляем файл
    try {
      const filePath = path.join(__dirname, "../..", overlay.imagePath);
      await fs.unlink(filePath);
    } catch (err) {
      console.log(`[Templates] Could not delete overlay file: ${err.message}`);
    }

    // Удаляем запись
    await prisma.templateOverlay.delete({ where: { id: overlayId } });

    res.json({ success: true });
  } catch (error) {
    console.error("[Templates] Failed to delete overlay:", error);
    res.status(500).json({ error: "Failed to delete overlay" });
  }
});

module.exports = router;
