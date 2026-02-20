# Humanize - Grok

AI video generation web app (Node + Python xAI SDK) with optional reference image upload.

## Current workflow

- User must input `XAI API Key` in the page before any action.
- Upload image and click `Auto-generate TikTok Prompt` to generate a product-selling prompt.
- Generate video with selected duration, resolution, and aspect ratio.
- All generated videos are listed in the history section with play + download actions.

## Local run

1. Install dependencies:

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

2. Configure environment:

```bash
cp .env.example .env
```

`.env` example:

```env
XAI_VIDEO_MODEL=grok-imagine-video
AUTO_PROMPT_MODEL=grok-2-vision-latest
IMAGE_PAD_COLOR=FFFFFF
PORT=3000
```

3. Start:

```bash
npm run dev
```

Open `http://localhost:3000`

## Deploy (Render, no custom domain needed)

1. Push code to GitHub.
2. Create Render Web Service using `Docker` runtime.
3. Add env vars:
- `XAI_VIDEO_MODEL=grok-imagine-video`
- `AUTO_PROMPT_MODEL=grok-2-vision-latest`
- `IMAGE_PAD_COLOR=FFFFFF`
- `PORT=3000`
4. Deploy and use the generated `*.onrender.com` URL.

## Notes

- The API key is provided per request from the UI and is not read from server env for generation.
- Pillow handles cross-platform image padding before video generation.
- Server prefers `./.venv/bin/python3` automatically (or set `PYTHON_BIN` to override).
- `/api/process-product-image` is kept as an optional legacy utility; the active scene pipeline does not use it.
