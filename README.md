# AI Video Generator — Backend

REST API for an AI tool that generates short videos for YouTube: writes the script with an LLM, voices it with TTS, picks music, assembles the video and uploads it to connected YouTube channels.

Part of a three-repo project:

| Repo | What it does | Stack |
| --- | --- | --- |
| [ai-video-generator-dashboard](https://github.com/ktimur91/ai-video-generator-dashboard) | Web UI | Vue 3, Vite, Tailwind CSS |
| **ai-video-generator-backend** (this one) | REST API, AI, media pipeline, YouTube upload | Node.js, Express, Prisma |
| [ai-video-generator-render](https://github.com/ktimur91/ai-video-generator-render) | Video templates and rendering | React, Remotion, TypeScript |

## Features

- Pluggable AI providers behind one interface: OpenAI and Google Gemini (`services/ai-providers`)
- AI assistant for scripts, titles and descriptions
- Text-to-speech voice-over (edge-tts) with per-voice settings
- Music selection from Jamendo
- Media processing with ffmpeg, file uploads with multer
- YouTube Data API: OAuth for several channels, upload and publishing
- Templates and video versions stored in a database via Prisma

## API

| Route group | Purpose |
| --- | --- |
| `videos` | Create, list, update, render videos and versions |
| `templates` | Video templates |
| `ai-assistant`, `ai-providers` | Script generation and provider selection |
| `voices` | TTS voices and settings |
| `music` | Music search and selection |
| `youtube` | Channel connection (OAuth) and publishing |

## Run locally

```bash
cp .env.example .env   # DATABASE_URL, OPENAI_API_KEY / GEMINI_API_KEY, Google OAuth client
npm i
npm run db:push
npm run dev
```

## Author

Timur Kutumbaev. Telegram: [@ktim91](https://t.me/ktim91)
