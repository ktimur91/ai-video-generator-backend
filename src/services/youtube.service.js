const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

// Путь для хранения токенов
const TOKENS_PATH = path.join(__dirname, "../../storage/youtube-tokens.json");

// OAuth2 клиент
let oauth2Client = null;

/**
 * Инициализация OAuth2 клиента
 */
function getOAuth2Client() {
  if (oauth2Client) return oauth2Client;

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI ||
    "http://localhost:3001/api/youtube/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube API credentials not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env"
    );
  }

  oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Попытка загрузить сохраненные токены
  const tokens = loadTokens();
  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }

  // Автообновление токенов
  oauth2Client.on("tokens", (tokens) => {
    console.log("[YouTube] Tokens refreshed");
    saveTokens(tokens);
  });

  return oauth2Client;
}

/**
 * Загрузка сохраненных токенов
 */
function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      const data = fs.readFileSync(TOKENS_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("[YouTube] Failed to load tokens:", error.message);
  }
  return null;
}

/**
 * Сохранение токенов
 */
function saveTokens(tokens) {
  try {
    // Объединяем с существующими токенами (для refresh_token)
    const existing = loadTokens() || {};
    const merged = { ...existing, ...tokens };
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(merged, null, 2));
    console.log("[YouTube] Tokens saved");
  } catch (error) {
    console.error("[YouTube] Failed to save tokens:", error.message);
  }
}

/**
 * Генерация URL для авторизации
 */
function getAuthUrl() {
  const client = getOAuth2Client();

  const scopes = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
  ];

  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent", // Всегда запрашивать refresh_token
  });

  return url;
}

/**
 * Обмен кода авторизации на токены
 */
async function handleAuthCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveTokens(tokens);
  return tokens;
}

/**
 * Проверка авторизации
 */
function isAuthenticated() {
  const tokens = loadTokens();
  return !!(tokens && tokens.access_token);
}

/**
 * Получение информации о канале
 */
async function getChannelInfo() {
  const client = getOAuth2Client();
  const youtube = google.youtube({ version: "v3", auth: client });

  const response = await youtube.channels.list({
    part: "snippet,statistics",
    mine: true,
  });

  if (response.data.items && response.data.items.length > 0) {
    const channel = response.data.items[0];
    return {
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails?.default?.url,
      subscriberCount: channel.statistics.subscriberCount,
    };
  }

  return null;
}

/**
 * Загрузка видео на YouTube
 */
async function uploadVideo({
  videoPath,
  title,
  description = "",
  tags = [],
  privacyStatus = "private", // private, public, unlisted
  categoryId = "22", // 22 = People & Blogs
  madeForKids = false,
}) {
  const client = getOAuth2Client();
  const youtube = google.youtube({ version: "v3", auth: client });

  // Проверяем что файл существует
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const fileSize = fs.statSync(videoPath).size;
  console.log(
    `[YouTube] Uploading video: ${title} (${(fileSize / 1024 / 1024).toFixed(
      2
    )} MB)`
  );

  // Создаем поток для загрузки
  const media = {
    body: fs.createReadStream(videoPath),
  };

  // Параметры видео
  const requestBody = {
    snippet: {
      title: title.substring(0, 100), // YouTube limit
      description: description.substring(0, 5000), // YouTube limit
      tags: tags.slice(0, 500), // YouTube limit
      categoryId,
      defaultLanguage: "ru",
      defaultAudioLanguage: "ru",
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: madeForKids,
    },
  };

  try {
    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody,
      media,
    });

    const video = response.data;
    console.log(`[YouTube] Video uploaded successfully: ${video.id}`);

    return {
      id: video.id,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      shortsUrl: `https://www.youtube.com/shorts/${video.id}`,
      title: video.snippet.title,
      status: video.status.privacyStatus,
    };
  } catch (error) {
    console.error("[YouTube] Upload failed:", error.message);
    throw error;
  }
}

/**
 * Выход из аккаунта
 */
function logout() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      fs.unlinkSync(TOKENS_PATH);
    }
    oauth2Client = null;
    console.log("[YouTube] Logged out");
    return true;
  } catch (error) {
    console.error("[YouTube] Logout failed:", error.message);
    return false;
  }
}

module.exports = {
  getAuthUrl,
  handleAuthCallback,
  isAuthenticated,
  getChannelInfo,
  uploadVideo,
  logout,
};
