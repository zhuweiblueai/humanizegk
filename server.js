const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const execFileAsync = promisify(execFile);

const PORT = process.env.PORT || 3000;
const XAI_VIDEO_MODEL = process.env.XAI_VIDEO_MODEL || "grok-imagine-video";
const IMAGE_PAD_COLOR = process.env.IMAGE_PAD_COLOR || "FFFFFF";

const ALLOWED_RESOLUTIONS = new Set(["480p", "720p"]);
const ALLOWED_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function assertApiKey(res) {
  if (!process.env.XAI_API_KEY) {
    res.status(500).json({
      error: "Missing XAI_API_KEY. Add it to your .env file."
    });
    return false;
  }
  return true;
}

function normalizeDuration(value) {
  const duration = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(duration)) return null;
  if (duration < 1 || duration > 15) return null;
  return duration;
}

function buildRequestPreview(payload, file) {
  const preview = { ...payload };
  if (!file) return preview;

  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  preview.image_url = {
    type: "data-uri",
    mime: file.mimetype || "application/octet-stream",
    bytes: file.size || file.buffer.length || 0,
    sha256
  };

  delete preview.image_path;
  return preview;
}

function extractVideoUrl(payload) {
  if (typeof payload?.video?.url === "string") return payload.video.url;
  if (typeof payload?.response?.video?.url === "string") return payload.response.video.url;
  if (typeof payload?.video_url === "string") return payload.video_url;
  if (typeof payload?.url === "string") return payload.url;
  return null;
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

app.post("/api/generate-video", upload.single("image"), async (req, res) => {
  if (!assertApiKey(res)) return;

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
      prompt,
      model: XAI_VIDEO_MODEL,
      duration,
      resolution
    };

    if (effectiveAspectRatio) sdkPayload.aspect_ratio = effectiveAspectRatio;
    if (imagePath) sdkPayload.image_path = imagePath;
    if (imagePath) sdkPayload.image_pad_color = IMAGE_PAD_COLOR;

    const requestPreview = buildRequestPreview(sdkPayload, req.file);
    const sdkResult = await generateVideoWithSdk(sdkPayload);
    const videoUrl = extractVideoUrl(sdkResult);
    imagePreprocess = sdkResult?.image_preprocess || { padded: false };

    if (!videoUrl) {
      return res.status(502).json({
        error: "SDK call completed but no video URL was returned.",
        request_preview: requestPreview,
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
      request_preview: requestPreview,
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
