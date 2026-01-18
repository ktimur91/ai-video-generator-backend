require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const videosRoutes = require("./routes/videos.routes");
const voicesRoutes = require("./routes/voices.routes");
const musicRoutes = require("./routes/music.routes");
const youtubeRoutes = require("./routes/youtube.routes");
const templatesRoutes = require("./routes/templates.routes");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from storage
app.use("/storage", express.static(path.join(__dirname, "../storage")));

// Routes
app.use("/api", videosRoutes);
app.use("/api/voices", voicesRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/youtube", youtubeRoutes);
app.use("/api/templates", templatesRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📁 Storage available at http://localhost:${PORT}/storage`);
});
