const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3000;
const XAI_VIDEO_MODEL = process.env.XAI_VIDEO_MODEL || "grok-imagine-video";
const IMAGE_PAD_COLOR = process.env.IMAGE_PAD_COLOR || "FFFFFF";
const XAI_BASE_URL = "https://api.x.ai/v1";
const AUTO_PROMPT_MODEL = process.env.AUTO_PROMPT_MODEL || "grok-2-vision-latest";

const ALLOWED_RESOLUTIONS = new Set(["480p", "720p"]);
const ALLOWED_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function normalizeDuration(value) {
  const duration = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(duration)) return null;
  if (duration < 1 || duration > 15) return null;
  return duration;
}

function extractVideoUrl(payload) {
  if (typeof payload?.video?.url === "string") return payload.video.url;
  if (typeof payload?.response?.video?.url === "string") return payload.response.video.url;
  if (typeof payload?.video_url === "string") return payload.video_url;
  if (typeof payload?.url === "string") return payload.url;
  return null;
}

function toDataUri(file) {
  if (!file) return null;
  const mimeType = file.mimetype || "image/png";
  const base64 = file.buffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

async function generateVideoWithSdk(payload) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xai-sdk-"));
  const requestPath = path.join(tempDir, "request.json");
  const scriptPath = path.join(__dirname, "scripts", "generate_video_with_xai_sdk.py");

  try {
    await fs.writeFile(requestPath, JSON.stringify(payload), "utf8");

    const { stdout, stderr } = await execFileAsync("python3", [scriptPath, requestPath], {
      env: process.env,
      maxBuffer: 16 * 1024 * 1024
    });

    if (stderr && stderr.trim()) {
      throw new Error(stderr.trim());
    }

    const parsed = JSON.parse(stdout || "{}");
    return parsed;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

app.post("/api/auto-prompt", upload.single("image"), async (req, res) => {
  const apiKey = String(req.body.api_key || "").trim();
  const image = req.file;

  if (!apiKey) {
    return res.status(400).json({ error: "api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }

  try {
    const imageUrl = toDataUri(image);

    const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: AUTO_PROMPT_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content:
              "You are an expert TikTok commerce video director. Output only one concise English prompt for text-to-video/image-to-video generation."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Based on this product image, create one concise prompt for a TikTok product-selling short video. Include hook, camera movement, key product highlights, CTA, and trendy e-commerce style."
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Failed to auto-generate prompt.",
        raw: data
      });
    }

    const prompt = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!prompt) {
      return res.status(502).json({ error: "Model returned empty prompt.", raw: data });
    }

    return res.json({ prompt, model: AUTO_PROMPT_MODEL });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-video", upload.single("image"), async (req, res) => {
  const apiKey = String(req.body.api_key || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "api_key is required." });
  }

  const prompt = String(req.body.prompt || "").trim();
  const duration = normalizeDuration(req.body.duration);
  const resolution = String(req.body.resolution || "480p").trim();
  const hasReferenceImage = Boolean(req.file);
  const requestedAspectRatio = String(req.body.aspect_ratio || "auto").trim().toLowerCase();
  let effectiveAspectRatio = null;

  if (!prompt) {
    return res.status(400).json({ error: "prompt is required." });
  }
  if (!duration) {
    return res.status(400).json({ error: "duration must be an integer between 1 and 15." });
  }
  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    return res.status(400).json({ error: "resolution must be 480p or 720p." });
  }
  if (requestedAspectRatio === "auto") {
    effectiveAspectRatio = hasReferenceImage ? null : "16:9";
  } else if (ALLOWED_ASPECT_RATIOS.has(requestedAspectRatio)) {
    effectiveAspectRatio = requestedAspectRatio;
  } else {
    return res.status(400).json({
      error: "aspect_ratio must be auto or one of 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3."
    });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xai-input-"));
  let imagePath = null;
  let imagePreprocess = { padded: false };

  try {
    if (req.file) {
      const ext = req.file.mimetype === "image/jpeg" ? ".jpg" : ".png";
      imagePath = path.join(tempDir, `reference${ext}`);
      await fs.writeFile(imagePath, req.file.buffer);
    }

    const sdkPayload = {
      api_key: apiKey,
      prompt,
      model: XAI_VIDEO_MODEL,
      duration,
      resolution
    };

    if (effectiveAspectRatio) sdkPayload.aspect_ratio = effectiveAspectRatio;
    if (imagePath) sdkPayload.image_path = imagePath;
    if (imagePath) sdkPayload.image_pad_color = IMAGE_PAD_COLOR;

    const sdkResult = await generateVideoWithSdk(sdkPayload);
    const videoUrl = extractVideoUrl(sdkResult);
    imagePreprocess = sdkResult?.image_preprocess || { padded: false };

    if (!videoUrl) {
      return res.status(502).json({
        error: "SDK call completed but no video URL was returned.",
        raw: sdkResult?.raw || sdkResult
      });
    }

    return res.json({
      status: "done",
      video_url: videoUrl,
      has_reference_image: hasReferenceImage,
      uploaded_image_mime: req.file?.mimetype || null,
      uploaded_image_bytes: req.file?.size || 0,
      image_preprocess: imagePreprocess,
      requested_aspect_ratio: requestedAspectRatio,
      effective_aspect_ratio: effectiveAspectRatio || "follow-input-image",
      duration,
      resolution,
      aspect_ratio: effectiveAspectRatio || "follow-input-image",
      raw: sdkResult?.raw || sdkResult
    });
  } catch (error) {
    const message = String(error.message || "Failed to generate video with xai_sdk.");
    const maybeMissingSdk = message.includes("No module named") && message.includes("xai_sdk");

    return res.status(500).json({
      error: maybeMissingSdk
        ? "Python package xai-sdk is not installed. Run: pip3 install xai-sdk"
        : message
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
