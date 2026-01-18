const express = require("express");
const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const prisma = require("../services/db.service");

const router = express.Router();

const REDIRECT_URI =
  process.env.YOUTUBE_REDIRECT_URI ||
  "http://localhost:3001/api/youtube/callback";

/**
 * Создаёт OAuth2 клиент для конкретных credentials
 */
function createOAuth2Client(credentials, channel = null) {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    REDIRECT_URI,
  );

  if (channel) {
    oauth2Client.setCredentials({
      access_token: channel.accessToken,
      refresh_token: channel.refreshToken,
      expiry_date: channel.tokenExpiry
        ? new Date(channel.tokenExpiry).getTime()
        : null,
    });

    // Автообновление токенов
    oauth2Client.on("tokens", async (tokens) => {
      console.log(
        `[YouTube] Tokens refreshed for channel ${channel.channelId}`,
      );
      try {
        await prisma.youTubeChannel.update({
          where: { id: channel.id },
          data: {
            accessToken: tokens.access_token || channel.accessToken,
            refreshToken: tokens.refresh_token || channel.refreshToken,
            tokenExpiry: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : null,
          },
        });
      } catch (err) {
        console.error("[YouTube] Failed to save refreshed tokens:", err);
      }
    });
  }

  return oauth2Client;
}

// ============================================================
// CREDENTIALS CRUD
// ============================================================

/**
 * GET /youtube/credentials
 * Получить список всех OAuth credentials
 */
router.get("/credentials", async (req, res) => {
  try {
    const credentials = await prisma.youTubeCredentials.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        channels: {
          select: {
            id: true,
            channelId: true,
            title: true,
            thumbnail: true,
            subscriberCount: true,
            email: true,
            isDefault: true,
          },
        },
      },
    });

    // Скрываем секреты при отдаче
    const safeCredentials = credentials.map((cred) => ({
      ...cred,
      clientSecret: "••••••••" + cred.clientSecret.slice(-4),
    }));

    res.json({ credentials: safeCredentials });
  } catch (error) {
    console.error("[YouTube] Failed to get credentials:", error);
    res
      .status(500)
      .json({ error: "Failed to get credentials", message: error.message });
  }
});

/**
 * POST /youtube/credentials
 * Добавить новые OAuth credentials
 */
router.post("/credentials", async (req, res) => {
  try {
    const { name, clientId, clientSecret } = req.body;

    if (!name || !clientId || !clientSecret) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "name, clientId, and clientSecret are required",
      });
    }

    const credentials = await prisma.youTubeCredentials.create({
      data: {
        name,
        clientId,
        clientSecret,
      },
    });

    res.json({
      success: true,
      credentials: {
        ...credentials,
        clientSecret: "••••••••" + credentials.clientSecret.slice(-4),
      },
    });
  } catch (error) {
    console.error("[YouTube] Failed to create credentials:", error);
    res
      .status(500)
      .json({ error: "Failed to create credentials", message: error.message });
  }
});

/**
 * PUT /youtube/credentials/:id
 * Обновить credentials
 */
router.put("/credentials/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, clientId, clientSecret } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (clientId) updateData.clientId = clientId;
    if (clientSecret) updateData.clientSecret = clientSecret;

    const credentials = await prisma.youTubeCredentials.update({
      where: { id },
      data: updateData,
    });

    res.json({
      success: true,
      credentials: {
        ...credentials,
        clientSecret: "••••••••" + credentials.clientSecret.slice(-4),
      },
    });
  } catch (error) {
    console.error("[YouTube] Failed to update credentials:", error);
    res
      .status(500)
      .json({ error: "Failed to update credentials", message: error.message });
  }
});

/**
 * DELETE /youtube/credentials/:id
 * Удалить credentials (каскадно удалит все связанные каналы)
 */
router.delete("/credentials/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем что нет опубликованных видео на каналах этих credentials
    const channels = await prisma.youTubeChannel.findMany({
      where: { credentialsId: id },
      select: { id: true },
    });

    const channelIds = channels.map((c) => c.id);

    if (channelIds.length > 0) {
      const videosCount = await prisma.video.count({
        where: { youtubeChannelId: { in: channelIds } },
      });

      if (videosCount > 0) {
        return res.status(400).json({
          error: "Credentials have published videos",
          message: `На каналах этих credentials опубликовано ${videosCount} видео`,
        });
      }
    }

    await prisma.youTubeCredentials.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[YouTube] Failed to delete credentials:", error);
    res
      .status(500)
      .json({ error: "Failed to delete credentials", message: error.message });
  }
});

// ============================================================
// CHANNEL AUTH & MANAGEMENT
// ============================================================

/**
 * GET /youtube/auth/:credentialsId
 * Получение URL для авторизации канала с конкретными credentials
 */
router.get("/auth/:credentialsId", async (req, res) => {
  try {
    const { credentialsId } = req.params;

    const credentials = await prisma.youTubeCredentials.findUnique({
      where: { id: credentialsId },
    });

    if (!credentials) {
      return res.status(404).json({ error: "Credentials not found" });
    }

    const oauth2Client = createOAuth2Client(credentials);

    const scopes = [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: "consent",
      state: credentialsId, // Передаём ID credentials в state
    });

    res.json({ authUrl: url });
  } catch (error) {
    console.error("[YouTube] Failed to generate auth URL:", error);
    res
      .status(500)
      .json({ error: "Failed to generate auth URL", message: error.message });
  }
});

/**
 * GET /youtube/callback
 * OAuth2 callback от Google
 */
router.get("/callback", async (req, res) => {
  try {
    const { code, error, state: credentialsId } = req.query;

    if (error) {
      return res.redirect(`http://localhost:5173?youtube_error=${error}`);
    }

    if (!code) {
      return res.redirect(`http://localhost:5173?youtube_error=no_code`);
    }

    if (!credentialsId) {
      return res.redirect(
        `http://localhost:5173?youtube_error=no_credentials_id`,
      );
    }

    // Получаем credentials
    const credentials = await prisma.youTubeCredentials.findUnique({
      where: { id: credentialsId },
    });

    if (!credentials) {
      return res.redirect(
        `http://localhost:5173?youtube_error=credentials_not_found`,
      );
    }

    const oauth2Client = createOAuth2Client(credentials);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Получаем информацию о канале
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelResponse = await youtube.channels.list({
      part: "snippet,statistics",
      mine: true,
    });

    if (
      !channelResponse.data.items ||
      channelResponse.data.items.length === 0
    ) {
      return res.redirect(`http://localhost:5173?youtube_error=no_channel`);
    }

    const channelData = channelResponse.data.items[0];

    // Получаем email пользователя
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let email = null;
    try {
      const userInfo = await oauth2.userinfo.get();
      email = userInfo.data.email;
    } catch (e) {
      console.log("[YouTube] Could not get email:", e.message);
    }

    // Проверяем, не добавлен ли уже этот канал
    const existingChannel = await prisma.youTubeChannel.findUnique({
      where: { channelId: channelData.id },
    });

    if (existingChannel) {
      // Обновляем токены существующего канала
      await prisma.youTubeChannel.update({
        where: { id: existingChannel.id },
        data: {
          credentialsId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existingChannel.refreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          title: channelData.snippet.title,
          thumbnail: channelData.snippet.thumbnails?.default?.url,
          subscriberCount: channelData.statistics.subscriberCount,
          email,
        },
      });
      return res.redirect(
        `http://localhost:5173?youtube_connected=true&channel_updated=true`,
      );
    }

    // Проверяем есть ли другие каналы (для isDefault)
    const channelCount = await prisma.youTubeChannel.count();

    // Создаём новый канал
    await prisma.youTubeChannel.create({
      data: {
        channelId: channelData.id,
        title: channelData.snippet.title,
        thumbnail: channelData.snippet.thumbnails?.default?.url,
        subscriberCount: channelData.statistics.subscriberCount,
        credentialsId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        email,
        isDefault: channelCount === 0,
      },
    });

    res.redirect(`http://localhost:5173?youtube_connected=true`);
  } catch (error) {
    console.error("[YouTube] OAuth callback error:", error);
    res.redirect(
      `http://localhost:5173?youtube_error=${encodeURIComponent(error.message)}`,
    );
  }
});

/**
 * GET /youtube/channels
 * Получить список подключенных каналов
 */
router.get("/channels", async (req, res) => {
  try {
    const channels = await prisma.youTubeChannel.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channelId: true,
        title: true,
        thumbnail: true,
        subscriberCount: true,
        email: true,
        isDefault: true,
        createdAt: true,
        credentials: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.json({ channels });
  } catch (error) {
    console.error("[YouTube] Failed to get channels:", error);
    res
      .status(500)
      .json({ error: "Failed to get channels", message: error.message });
  }
});

/**
 * DELETE /youtube/channels/:id
 * Удалить канал
 */
router.delete("/channels/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Проверяем что канал не используется в опубликованных видео
    const videosWithChannel = await prisma.video.count({
      where: { youtubeChannelId: id },
    });

    if (videosWithChannel > 0) {
      return res.status(400).json({
        error: "Channel has published videos",
        message: `На этом канале опубликовано ${videosWithChannel} видео`,
      });
    }

    await prisma.youTubeChannel.delete({
      where: { id },
    });

    // Если удалили дефолтный канал, назначаем новый
    const defaultChannel = await prisma.youTubeChannel.findFirst({
      where: { isDefault: true },
    });

    if (!defaultChannel) {
      const firstChannel = await prisma.youTubeChannel.findFirst();
      if (firstChannel) {
        await prisma.youTubeChannel.update({
          where: { id: firstChannel.id },
          data: { isDefault: true },
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[YouTube] Failed to delete channel:", error);
    res
      .status(500)
      .json({ error: "Failed to delete channel", message: error.message });
  }
});

/**
 * PUT /youtube/channels/:id/default
 * Установить канал по умолчанию
 */
router.put("/channels/:id/default", async (req, res) => {
  try {
    const { id } = req.params;

    // Сбрасываем isDefault у всех каналов
    await prisma.youTubeChannel.updateMany({
      data: { isDefault: false },
    });

    // Устанавливаем isDefault для выбранного канала
    const channel = await prisma.youTubeChannel.update({
      where: { id },
      data: { isDefault: true },
    });

    res.json({ success: true, channel });
  } catch (error) {
    console.error("[YouTube] Failed to set default channel:", error);
    res.status(500).json({
      error: "Failed to set default channel",
      message: error.message,
    });
  }
});

// ============================================================
// VIDEO PUBLISHING
// ============================================================

/**
 * POST /youtube/publish
 * Публикация видео на YouTube
 */
router.post("/publish", async (req, res) => {
  try {
    const {
      videoId,
      channelId,
      customTitle,
      customDescription,
      tags = [],
      categoryId = "24",
      privacyStatus = "private",
    } = req.body;

    if (!videoId || !channelId) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "videoId and channelId are required",
      });
    }

    // Получаем канал с credentials
    const channel = await prisma.youTubeChannel.findUnique({
      where: { id: channelId },
      include: { credentials: true },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (!channel.credentials) {
      return res.status(400).json({ error: "Channel has no credentials" });
    }

    // Получаем видео из БД
    const video = await prisma.video.findUnique({
      where: { id: videoId },
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
    const videoPath = path.isAbsolute(video.videoPath)
      ? video.videoPath
      : path.join(__dirname, "../../", video.videoPath);

    try {
      await fs.access(videoPath);
    } catch {
      return res.status(400).json({
        error: "Video file not found",
        message: "The rendered video file is missing",
      });
    }

    // Создаём OAuth клиент
    const oauth2Client = createOAuth2Client(channel.credentials, channel);

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

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

    console.log(`[YouTube] Uploading video to channel: ${channel.title}`);

    // Загружаем видео
    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: {
          title: customTitle || video.title,
          description,
          tags: finalTags,
          categoryId,
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: require("fs").createReadStream(videoPath),
      },
    });

    const youtubeVideoId = response.data.id;
    const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    const shortsUrl = `https://www.youtube.com/shorts/${youtubeVideoId}`;

    console.log(`[YouTube] Video uploaded: ${youtubeUrl}`);

    // Обновляем запись в БД
    await prisma.video.update({
      where: { id: videoId },
      data: {
        youtubeId: youtubeVideoId,
        youtubeUrl,
        youtubeStatus: privacyStatus,
        youtubeChannelId: channelId,
        publishedAt: new Date(),
      },
    });

    res.json({
      success: true,
      youtube: {
        id: youtubeVideoId,
        url: youtubeUrl,
        shortsUrl,
        channelTitle: channel.title,
      },
    });
  } catch (error) {
    console.error("[YouTube] Publish error:", error);
    res.status(500).json({
      error: "Failed to publish video",
      message: error.message,
    });
  }
});

module.exports = router;
