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
const XAI_BASE_URL = "https://api.x.ai/v1";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const AUTO_PROMPT_MODEL = process.env.AUTO_PROMPT_MODEL || "gpt-4.1-mini";
const VIDEO_PROMPT_APPEND =
  "上传图只作服装风格参考，不是第一帧，这是面向tiktok 马来西亚市场，用马来人作为人物，用马来语作为口播内容。";

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

function maskApiKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function normalizeVideoCount(value) {
  const count = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(count)) return 3;
  if (count < 1) return 1;
  if (count > 8) return 8;
  return count;
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

function summarizeDataUri(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  const bytes = Buffer.byteLength(b64, "base64");
  const sha256 = crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
  return { type: "data-uri", mime, bytes, sha256 };
}

function summarizeUploadedFile(file) {
  if (!file?.buffer) return null;
  return {
    mime: file.mimetype || "application/octet-stream",
    bytes: file.size || file.buffer.length,
    sha256: crypto.createHash("sha256").update(file.buffer).digest("hex")
  };
}

function toPreviewText(value, maxLen = 4000) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (value == null) {
    text = "";
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}\n...<truncated>`;
}

function buildOpenAiResponsePreview(data) {
  const message = data?.choices?.[0]?.message;
  return {
    id: data?.id || null,
    model: data?.model || null,
    finish_reason: data?.choices?.[0]?.finish_reason || null,
    message_content: toPreviewText(message?.content),
    usage: data?.usage || null
  };
}

function extractPromptListFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];

  const fencedJsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedJsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedJsonMatch[1]);
      if (typeof parsed?.prompt === "string") {
        return [parsed.prompt.trim()].filter(Boolean);
      }
      if (Array.isArray(parsed?.prompts)) {
        return parsed.prompts.map((p) => String(p || "").trim()).filter(Boolean);
      }
    } catch {
      // Ignore parse errors and continue.
    }
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((p) => String(p || "").trim()).filter(Boolean);
      }
    } catch {
      // Ignore parse errors and continue.
    }
  }

  const directJsonMatch = text.match(/\{[\s\S]*\}/);
  if (directJsonMatch) {
    try {
      const parsed = JSON.parse(directJsonMatch[0]);
      if (typeof parsed?.prompt === "string") {
        return [parsed.prompt.trim()].filter(Boolean);
      }
      if (Array.isArray(parsed?.prompts)) {
        return parsed.prompts.map((p) => String(p || "").trim()).filter(Boolean);
      }
    } catch {
      // Ignore parse errors and fallback to line parsing.
    }
  }

  const lines = text
    .split("\n")
    .map((line) => line.replace(/```json|```/gi, ""))
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);

  return lines.slice(0, 3);
}

function coerceTextFromAny(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => coerceTextFromAny(item)).filter(Boolean).join("\n");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
    if (typeof value.value === "string") return value.value.trim();
    if (typeof value.output_text === "string") return value.output_text.trim();
    return "";
  }
  return "";
}

function normalizePromptEntry(entry) {
  const normalizeValue = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const parts = value.map((item) => normalizeValue(item)).filter(Boolean);
      if (!parts.length) return "";
      return parts.map((item) => `- ${item}`).join("\n");
    }
    if (typeof value === "object") {
      if (typeof value.prompt === "string") return value.prompt.trim();
      if (typeof value.text === "string") return value.text.trim();
      if (typeof value.content === "string") return value.content.trim();
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return "";
      }
    }
    return "";
  };

  if (typeof entry === "string") {
    return entry.trim();
  }

  if (!entry || typeof entry !== "object") {
    return "";
  }

  if (typeof entry.prompt === "string") return entry.prompt.trim();
  if (typeof entry.text === "string") return entry.text.trim();
  if (typeof entry.content === "string") return entry.content.trim();

  const sections = [];
  const maybePush = (label, value) => {
    const text = normalizeValue(value);
    if (!text) return;
    sections.push(`${label}: ${text}`);
  };

  maybePush("Video concept and hook", entry.video_concept || entry.concept || entry.hook);
  maybePush("Malay model design", entry.model_design || entry.character || entry.model);
  maybePush(
    "Scene/background/environment",
    entry.scene || entry.background || entry.environment || entry.setting
  );
  maybePush("Camera and motion plan", entry.camera || entry.motion || entry.camera_plan);
  maybePush("Malay voice-over script", entry.voiceover || entry.voice_over || entry.script);
  maybePush("Selling points and CTA", entry.selling_points || entry.cta || entry.call_to_action);

  if (sections.length) return sections.join("\n");
  return normalizeValue(entry);
}

function extractPromptFromModelResponse(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return "";

  const sanitizePromptText = (value) => {
    let text = String(value || "").trim();
    if (!text) return "";

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) text = fenced[1].trim();

    // If it still looks like JSON, try parse/extract prompt field.
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed?.prompt === "string") return parsed.prompt.trim();
        if (Array.isArray(parsed?.prompts) && parsed.prompts.length) {
          return normalizePromptEntry(parsed.prompts[0]);
        }
      } catch {
        const regex = /"prompt"\s*:\s*"([\s\S]*?)"/i;
        const m = text.match(regex);
        if (m?.[1]) {
          return m[1].replace(/\\"/g, "\"").trim();
        }
      }
    }

    text = text.replace(/^prompt\s*:\s*/i, "").trim();
    if (text === "{" || text === "}" || text === "[" || text === "]") return "";
    return text;
  };

  if (typeof message.prompt === "string") {
    return sanitizePromptText(message.prompt);
  }

  if (Array.isArray(message.prompts) && message.prompts.length) {
    return normalizePromptEntry(message.prompts[0]);
  }

  const rawContent = message.content;
  if (typeof rawContent === "string") {
    const text = rawContent.trim();
    if (!text) return "";

    const fencedJsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (fencedJsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(fencedJsonMatch[1]);
        if (typeof parsed?.prompt === "string") return sanitizePromptText(parsed.prompt);
        if (Array.isArray(parsed?.prompts) && parsed.prompts.length) {
          return sanitizePromptText(normalizePromptEntry(parsed.prompts[0]));
        }
      } catch {
        // no-op, continue fallback
      }
    }

    // JSON payloads: {"prompt":"..."} or {"prompts":["..."]}
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed?.prompt === "string") return sanitizePromptText(parsed.prompt);
      if (Array.isArray(parsed?.prompts) && parsed.prompts.length) {
        return sanitizePromptText(normalizePromptEntry(parsed.prompts[0]));
      }
    } catch {
      // no-op, fallback below
    }

    // For plain text responses, keep the full body as one prompt.
    return sanitizePromptText(text);
  }

  if (Array.isArray(rawContent)) {
    const combined = rawContent
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (combined) return sanitizePromptText(combined);

    for (const part of rawContent) {
      const value =
        normalizePromptEntry(part?.prompt) ||
        normalizePromptEntry(part?.text) ||
        normalizePromptEntry(part?.content) ||
        normalizePromptEntry(part);
      if (value && value !== "[object Object]") return sanitizePromptText(value);
    }
  }

  if (rawContent && typeof rawContent === "object") {
    const value =
      normalizePromptEntry(rawContent.prompt) ||
      normalizePromptEntry(rawContent.text) ||
      normalizePromptEntry(rawContent.content) ||
      normalizePromptEntry(rawContent);
    if (value && value !== "[object Object]") return sanitizePromptText(value);
  }

  return "";
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
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;
  const count = normalizeVideoCount(req.body.count);
  const duration = normalizeDuration(req.body.duration) || 4;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }

  try {
    const imageUrl = toDataUri(image);
    const imagePreview = summarizeDataUri(imageUrl);
    const xaiRequestBody = {
      model: AUTO_PROMPT_MODEL,
      temperature: 0.5,
      messages: [
          {
            role: "system",
            content:
              "You are an expert TikTok commerce video director. Analyze the uploaded image content and return one complete prompt as plain text only. Do not return JSON. Do not return markdown code fences."
          },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Generate one standalone TikTok selling video prompt based on this uploaded clothing image. Return plain text only, no JSON, no markdown. The prompt must be designed for exactly ${duration} seconds, and the shot plan + Malay voice-over must match this duration. The prompt must be production-ready and include: 1) Video concept and hook, 2) Malay model design (age range, look, styling), 3) A newly designed selling scene/background/environment, 4) Camera and motion plan, 5) Malay voice-over script (3-5 lines) paced for ${duration} seconds, 6) Selling points and CTA. Hard requirements: Do NOT use the uploaded image as the first frame; the uploaded image is only a clothing style reference. Do NOT reuse the original image background/environment. Target market TikTok Malaysia. Characters are Malay people. Voice-over language is Bahasa Melayu.`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    };
    const requestPreview = {
      endpoint: "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
      model: xaiRequestBody.model,
      temperature: xaiRequestBody.temperature,
      messages: [
        xaiRequestBody.messages[0],
        {
          role: "user",
          content: [
            xaiRequestBody.messages[1].content[0],
            { type: "image_url", image_url: imagePreview }
          ]
        }
      ]
    };

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(xaiRequestBody)
    });

    const data = await response.json();
    const responsePreview = buildOpenAiResponsePreview(data);
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Failed to auto-generate prompt.",
        raw: data,
        request_preview: requestPreview,
        response_preview: responsePreview
      });
    }

    const prompt = extractPromptFromModelResponse(data);
    if (!prompt || prompt === "[object Object]") {
      return res.status(502).json({
        error: "Model returned invalid prompt.",
        raw: data,
        request_preview: requestPreview,
        response_preview: responsePreview
      });
    }

    return res.json({
      prompt,
      model: AUTO_PROMPT_MODEL,
      request_preview: requestPreview,
      response_preview: responsePreview
    });
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
  const finalPrompt = `${prompt}\n\n${VIDEO_PROMPT_APPEND}`.trim();
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
      prompt: finalPrompt,
      model: XAI_VIDEO_MODEL,
      duration,
      resolution
    };

    if (effectiveAspectRatio) sdkPayload.aspect_ratio = effectiveAspectRatio;
    if (imagePath) sdkPayload.image_path = imagePath;
    if (imagePath) sdkPayload.image_pad_color = IMAGE_PAD_COLOR;
    const requestPreview = {
      endpoint: "/video.generate (xai_sdk)",
      authorization: `Bearer ${maskApiKey(apiKey)}`,
      payload: {
        model: sdkPayload.model,
        prompt: sdkPayload.prompt,
        duration: sdkPayload.duration,
        resolution: sdkPayload.resolution,
        aspect_ratio: sdkPayload.aspect_ratio || "follow-input-image",
        image: summarizeUploadedFile(req.file),
        image_pad_color: imagePath ? IMAGE_PAD_COLOR : null
      }
    };

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
