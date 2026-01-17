const express = require("express");
const {
  searchTracks,
  getTrackById,
  searchMusicForTopic,
  getPopularByGenre,
  getRecommendedForTheme,
  MUSIC_GENRES,
  MOOD_TO_TAGS,
} = require("../services/jamendo.service");

const router = express.Router();

/**
 * GET /music/search
 * Поиск музыки с фильтрами
 */
router.get("/search", async (req, res) => {
  try {
    const {
      q: query = "",
      tags = "",
      genres = "",
      mood = "",
      speed = "",
      instrumental = "true",
      limit = 20,
      page = 1,
    } = req.query;

    const tracks = await searchTracks({
      query,
      tags: tags ? tags.split(",").map((t) => t.trim()) : [],
      genres: genres ? genres.split(",").map((g) => g.trim()) : [],
      mood: mood || null,
      speed: speed || null,
      instrumental: instrumental === "true",
      limit: parseInt(limit),
      page: parseInt(page),
    });

    res.json({
      success: true,
      tracks,
      count: tracks.length,
      page: parseInt(page),
    });
  } catch (error) {
    console.error("[Music] Search error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /music/track/:id
 * Получить трек по ID
 */
router.get("/track/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const track = await getTrackById(id);

    if (!track) {
      return res.status(404).json({
        success: false,
        error: "Track not found",
      });
    }

    res.json({
      success: true,
      track,
    });
  } catch (error) {
    console.error("[Music] Get track error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /music/search-for-topic
 * Поиск музыки для конкретной темы с AI-сгенерированными параметрами
 */
router.post("/search-for-topic", async (req, res) => {
  try {
    const {
      keywords = [],
      mood = null,
      tempo = "medium",
      limit = 10,
    } = req.body;

    const tracks = await searchMusicForTopic({
      keywords,
      mood,
      tempo,
      limit,
    });

    res.json({
      success: true,
      tracks,
      count: tracks.length,
    });
  } catch (error) {
    console.error("[Music] Search for topic error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /music/popular/:genre
 * Популярные треки по жанру
 */
router.get("/popular/:genre", async (req, res) => {
  try {
    const { genre } = req.params;
    const { limit = 10 } = req.query;

    const tracks = await getPopularByGenre(genre, parseInt(limit));

    res.json({
      success: true,
      tracks,
      count: tracks.length,
      genre,
    });
  } catch (error) {
    console.error("[Music] Popular by genre error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /music/recommended/:theme
 * Рекомендуемая музыка для типа темы
 */
router.get("/recommended/:theme", async (req, res) => {
  try {
    const { theme } = req.params;

    const tracks = await getRecommendedForTheme(theme);

    res.json({
      success: true,
      tracks,
      count: tracks.length,
      theme,
    });
  } catch (error) {
    console.error("[Music] Recommended error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /music/genres
 * Список доступных жанров
 */
router.get("/genres", (req, res) => {
  res.json({
    success: true,
    genres: MUSIC_GENRES,
  });
});

/**
 * GET /music/moods
 * Список доступных настроений
 */
router.get("/moods", (req, res) => {
  res.json({
    success: true,
    moods: Object.keys(MOOD_TO_TAGS),
  });
});

module.exports = router;
