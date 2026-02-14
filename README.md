# Humanize - Grok

AI video generation web app (Node + Python xAI SDK) with optional reference image upload.

## What it does

- Prompt-to-video and image-to-video
- Shows `Request Sent To Grok` on the page
- Cross-platform image padding via Pillow to avoid stretching when aspect ratio is forced

## Local run

1. Install dependencies:

```bash
npm install
python3 -m pip install -r requirements.txt
```

2. Configure environment:

```bash
cp .env.example .env
```

`.env` example:

```env
XAI_API_KEY=your_xai_api_key_here
XAI_VIDEO_MODEL=grok-imagine-video
IMAGE_PAD_COLOR=FFFFFF
PORT=3000
```

3. Start:

```bash
npm run dev
```

Open `http://localhost:3000`

## Deploy to public internet (no domain required) - Render free subdomain

This deploy path gives you a public URL like `https://your-app.onrender.com`.

1. Push this project to GitHub.
2. Go to Render and create a **New Web Service**.
3. Connect your GitHub repo.
4. In service settings:
- Runtime: `Docker`
- Branch: your main branch
- Region: nearest to your users
5. Add environment variables in Render:
- `XAI_API_KEY`
- `XAI_VIDEO_MODEL=grok-imagine-video`
- `IMAGE_PAD_COLOR=FFFFFF`
- `PORT=3000`
6. Click **Deploy**.
7. Open the generated `*.onrender.com` URL.

## Files for deployment

- `Dockerfile`
- `.dockerignore`
- `requirements.txt`

## Notes

- Pillow-based padding runs in Python script `scripts/generate_video_with_xai_sdk.py`.
- If `aspect_ratio=auto`, app does not force ratio for reference-image mode.
- If you later buy a domain, attach it in Render Custom Domains settings.
