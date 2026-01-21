const express = require("express");
const {
  processSegmentRequest,
  processVideoRequest,
} = require("../services/ai-assistant.service");

const router = express.Router();

/**
 * POST /segment
 * AI помощник на уровне сегмента
 * Body: { message, chatHistory, context: { segmentText, segmentType, segmentIndex, currentVideos } }
 */
router.post("/segment", async (req, res) => {
  try {
    const { message, chatHistory = [], context = {} } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const result = await processSegmentRequest(message, chatHistory, context);

    res.json(result);
  } catch (error) {
    console.error("[AI Routes] Segment request error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /video
 * AI помощник на уровне всего видео
 * Body: { message, chatHistory, context: { title, segments, music, template } }
 */
router.post("/video", async (req, res) => {
  try {
    const { message, chatHistory = [], context = {} } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const result = await processVideoRequest(message, chatHistory, context);

    res.json(result);
  } catch (error) {
    console.error("[AI Routes] Video request error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
