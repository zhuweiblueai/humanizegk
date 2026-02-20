const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fsSync = require("fs");
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
const OPENAI_IMAGE_EDIT_MODEL = process.env.OPENAI_IMAGE_EDIT_MODEL || "gpt-image-1";
const OPENAI_CHAT_TIMEOUT_MS = Number.parseInt(process.env.OPENAI_CHAT_TIMEOUT_MS || "", 10) || 120_000;
const OPENAI_IMAGE_EDIT_TIMEOUT_MS =
  Number.parseInt(process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS || "", 10) || 240_000;
const OPENAI_IMAGE_FETCH_TIMEOUT_MS =
  Number.parseInt(process.env.OPENAI_IMAGE_FETCH_TIMEOUT_MS || "", 10) || 60_000;
const LOCAL_VENV_PYTHON = path.join(__dirname, ".venv", "bin", "python3");
const PYTHON_BIN = String(process.env.PYTHON_BIN || "").trim() || (fsSync.existsSync(LOCAL_VENV_PYTHON) ? LOCAL_VENV_PYTHON : "python3");
const VIDEO_PROMPT_APPEND =
  "If an input image is provided, use it as the FIRST FRAME (image-to-video). This video targets the TikTok Malaysia market, uses Malay people as characters, and uses Bahasa Melayu for voice-over. Do not add on-screen text, logos, or watermarks.";

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

function detectMimeFromDataUri(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,/);
  if (!match) return "image/png";
  return match[1];
}

function parseAspectRatio(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) return null;
  const w = Number.parseInt(match[1], 10);
  const h = Number.parseInt(match[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

function pickOpenAiImageSizeFromAspectRatio(aspectRatioValue) {
  const raw = String(aspectRatioValue || "").trim().toLowerCase();
  if (!raw || raw === "auto") return "auto";
  const ratio = parseAspectRatio(raw);
  if (!ratio) return "auto";
  if (Math.abs(ratio - 1) <= 0.04) return "1024x1024";
  return ratio > 1 ? "1536x1024" : "1024x1536";
}

async function coerceOpenAiImageDataUri(imageData) {
  const first = imageData?.data?.[0] || {};

  if (typeof first?.b64_json === "string" && first.b64_json.length) {
    return {
      dataUri: `data:image/png;base64,${first.b64_json}`,
      outputType: "b64_json",
      outputUrl: first?.url || null,
      b64Length: String(first.b64_json).length,
      downloadError: null
    };
  }

  if (typeof first?.url === "string" && first.url.length) {
    try {
      const imageRes = await fetchWithTimeout(first.url, {}, OPENAI_IMAGE_FETCH_TIMEOUT_MS);
      if (imageRes.ok) {
        const arr = await imageRes.arrayBuffer();
        const mime = imageRes.headers.get("content-type") || "image/png";
        const b64 = Buffer.from(arr).toString("base64");
        return {
          dataUri: `data:${mime};base64,${b64}`,
          outputType: "url",
          outputUrl: first.url,
          b64Length: 0,
          downloadError: null
        };
      }

      return {
        dataUri: null,
        outputType: "url",
        outputUrl: first.url,
        b64Length: 0,
        downloadError: `Image download failed with HTTP ${imageRes.status}.`
      };
    } catch (error) {
      return {
        dataUri: null,
        outputType: "url",
        outputUrl: first.url,
        b64Length: 0,
        downloadError: String(error.message || error)
      };
    }
  }

  return {
    dataUri: null,
    outputType: null,
    outputUrl: null,
    b64Length: 0,
    downloadError: null
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

function extractTextFromOpenAiMessage(data) {
  const message = data?.choices?.[0]?.message;
  if (!message) return "";
  if (typeof message.content === "string") return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof message.content === "object" && message.content) {
    return coerceTextFromAny(message.content);
  }
  return "";
}

function parseDirections(text, count) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const coerceItems = (value) => {
    if (Array.isArray(value)) {
      return value.map((v) => String(v || "").trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split("\n")
        .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
        .filter(Boolean);
    }
    return [];
  };

  const tryParseJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return coerceItems(parsed);
      if (parsed && typeof parsed === "object") {
        const items = coerceItems(parsed.directions || parsed.direction);
        if (items.length) return items;
      }
    } catch {
      // ignore parse errors
    }
    return [];
  };

  const parseCandidates = [];
  const fencedJson = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedJson?.[1]) parseCandidates.push(fencedJson[1]);
  parseCandidates.push(raw);

  for (const candidate of parseCandidates) {
    const items = tryParseJson(candidate);
    if (items.length) return items.slice(0, count);
  }

  const extractedCandidates = [];
  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) extractedCandidates.push(objectMatch[0]);
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) extractedCandidates.push(arrayMatch[0]);
  for (const candidate of extractedCandidates) {
    const items = tryParseJson(candidate);
    if (items.length) return items.slice(0, count);
  }

  const lines = raw
    .split("\n")
    .map((line) => line.replace(/```json|```/gi, ""))
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
    .filter(Boolean);
  if (lines.length) return lines.slice(0, count);

  const blocks = raw
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, "").trim())
        .filter(Boolean)
        .join(" ")
        .trim()
    )
    .filter(Boolean);
  if (blocks.length) return blocks.slice(0, count);
  return lines.slice(0, count);
}

function mergeUniqueStrings(items, extra, limit) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };

  (items || []).forEach(add);
  (extra || []).forEach(add);
  return out.slice(0, limit);
}

function normalizeSceneKeywordList(value) {
  const tokens = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，/|;、\n]/g)
      : [];
  const dedup = [];
  const seen = new Set();
  tokens.forEach((item) => {
    const word = String(item || "").trim();
    if (!word) return;
    const key = word.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    dedup.push(word);
  });
  return dedup.slice(0, 8);
}

function normalizeSceneDirectionItem(entry) {
  if (typeof entry === "string") {
    const direction = entry.trim();
    if (!direction) return null;
    return {
      direction,
      scene_keywords: [],
      characters: "",
      script: ""
    };
  }

  if (!entry || typeof entry !== "object") return null;

  const direction = [
    entry.direction,
    entry.scene_direction,
    entry.story,
    entry.storyline,
    entry.video_direction,
    entry.brief,
    entry.plan
  ]
    .map((value) => coerceTextFromAny(value))
    .find(Boolean);

  if (!direction) return null;

  const sceneKeywords = normalizeSceneKeywordList(
    entry.scene_keywords || entry.keywords || entry.scene_keyword || entry.tags || []
  );
  const characters = coerceTextFromAny(
    entry.characters || entry.character || entry.character_design || entry.cast || entry.people
  );
  const script = coerceTextFromAny(
    entry.script || entry.voiceover || entry.voice_over || entry.storyboard || entry.video_script
  );

  return {
    direction,
    scene_keywords: sceneKeywords,
    characters,
    script
  };
}

function parseSceneDirections(text, count) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const tryParseJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => normalizeSceneDirectionItem(item)).filter(Boolean);
      }
      if (parsed && typeof parsed === "object") {
        const items = parsed.directions || parsed.scenes || parsed.items || parsed.direction || [];
        if (Array.isArray(items)) {
          return items.map((item) => normalizeSceneDirectionItem(item)).filter(Boolean);
        }
        const single = normalizeSceneDirectionItem(items);
        return single ? [single] : [];
      }
    } catch {
      // ignore parse errors
    }
    return [];
  };

  const parseCandidates = [];
  const fencedJson = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedJson?.[1]) parseCandidates.push(fencedJson[1]);
  parseCandidates.push(raw);

  for (const candidate of parseCandidates) {
    const scenes = tryParseJson(candidate);
    if (scenes.length) return scenes.slice(0, count);
  }

  const fallback = parseDirections(raw, count)
    .map((line) => normalizeSceneDirectionItem(line))
    .filter(Boolean);
  return fallback.slice(0, count);
}

function mergeUniqueScenes(items, extra, limit) {
  const out = [];
  const seen = new Set();
  const add = (entry) => {
    const scene = normalizeSceneDirectionItem(entry);
    if (!scene) return;
    const key = scene.direction.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(scene);
  };
  (items || []).forEach(add);
  (extra || []).forEach(add);
  return out.slice(0, limit);
}

function buildSceneBrief(scene) {
  const normalized = normalizeSceneDirectionItem(scene);
  if (!normalized) return "";
  const lines = [`Scene direction: ${normalized.direction}`];
  if (normalized.scene_keywords.length) {
    lines.push(`Scene keywords: ${normalized.scene_keywords.join(", ")}`);
  }
  if (normalized.characters) lines.push(`Characters: ${normalized.characters}`);
  if (normalized.script) lines.push(`Script idea: ${normalized.script}`);
  return lines.join("\n");
}

async function generateVideoPromptFromScene({ openaiApiKey, imageFile, scene, duration }) {
  const normalizedScene = normalizeSceneDirectionItem(scene);
  if (!normalizedScene) {
    const err = new Error("scene is required.");
    err.openaiStatus = 400;
    throw err;
  }

  const imageUrl = toDataUri(imageFile);
  const imagePreview = summarizeDataUri(imageUrl);
  const directionBrief = buildSceneBrief(normalizedScene);

  const promptRequestBody = {
    model: AUTO_PROMPT_MODEL,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content:
          "You are an expert TikTok commerce video director. Return one complete production-ready prompt as plain text only. No JSON. No markdown."
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `Convert this scene direction into one final video-generation prompt:\n${directionBrief}\n\nThe final prompt must fit ${duration} seconds and include: 1) video concept and hook, 2) Malay model design, 3) scene/background/environment, 4) camera and motion plan, 5) Bahasa Melayu voice-over script paced for ${duration} seconds, 6) selling points and CTA, 7) voice age/tone design aligned to the ages described in scene direction/scene_keywords/characters, 8) one explicit line: "Voice-over speaker age: <exact age or tight range>" chosen as the most suitable voice age for this scene and buying persona. If multiple ages exist in the scene, pick the best primary narrator age and state it explicitly. Mandatory constraints: target TikTok Malaysia, Malay people as characters, Bahasa Melayu voice-over, do NOT reuse the original reference image background/environment, no on-screen text/logos/watermarks. The attached image is the generated first-frame image for this exact scene: use it as the opening-frame reference and preserve opening-shot continuity for composition, characters, pose, clothing details, camera angle, and framing.`
          },
          {
            type: "image_url",
            image_url: { url: imageUrl }
          }
        ]
      }
    ]
  };

  const promptRequestPreview = {
    endpoint: "https://api.openai.com/v1/chat/completions",
    authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
    model: promptRequestBody.model,
    temperature: promptRequestBody.temperature,
    messages: [
      promptRequestBody.messages[0],
      {
        role: "user",
        content: [
          {
            type: "text",
            text: toPreviewText(promptRequestBody.messages[1].content[0]?.text, 2200)
          },
          { type: "image_url", image_url: imagePreview }
        ]
      }
    ]
  };

  const promptCall = await callOpenAiChat({
    apiKey: openaiApiKey,
    body: promptRequestBody
  });
  const promptResponsePreview = buildOpenAiResponsePreview(promptCall.data);
  if (!promptCall.ok) {
    const err = new Error(promptCall.data?.error?.message || "Failed to generate video prompt.");
    err.openaiStatus = promptCall.status;
    err.openaiRaw = promptCall.data;
    err.promptDebug = {
      request: promptRequestPreview,
      response: promptResponsePreview,
      raw: promptCall.data
    };
    throw err;
  }

  const prompt = extractPromptFromModelResponse(promptCall.data);
  if (!prompt || prompt === "[object Object]") {
    const err = new Error("Generated video prompt is invalid.");
    err.openaiStatus = 502;
    err.openaiRaw = promptCall.data;
    err.promptDebug = {
      request: promptRequestPreview,
      response: promptResponsePreview,
      raw: promptCall.data
    };
    throw err;
  }

  return {
    scene: normalizedScene,
    prompt,
    prompt_debug: {
      request: promptRequestPreview,
      response: promptResponsePreview,
      raw: promptCall.data,
      extracted_prompt_preview: toPreviewText(prompt, 2200)
    }
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonFromResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.length > 4000 ? `${text.slice(0, 4000)}\n...<truncated>` : text;
    return {
      error: { message: "Non-JSON response received." },
      _raw_text_preview: preview
    };
  }
}

async function callOpenAiChat({ apiKey, body }) {
  let response;
  try {
    response = await fetchWithTimeout(
      `${OPENAI_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      OPENAI_CHAT_TIMEOUT_MS
    );
  } catch (error) {
    return {
      ok: false,
      status: 504,
      data: {
        error: { message: `OpenAI chat request failed: ${String(error.message || error)}` },
        _network_error: true
      }
    };
  }

  const data = await readJsonFromResponse(response);
  return { ok: response.ok, status: response.status, data };
}

async function callOpenAiImageEdit({
  apiKey,
  imageFile,
  prompt,
  size = "1024x1024",
  quality = "auto",
  inputFidelity = "high"
}) {
  const form = new FormData();
  const blob = new Blob([imageFile.buffer], {
    type: imageFile.mimetype || "image/png"
  });
  form.append("model", OPENAI_IMAGE_EDIT_MODEL);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("input_fidelity", inputFidelity);
  form.append("image", blob, imageFile.originalname || "reference.png");

  let response;
  try {
    response = await fetchWithTimeout(
      `${OPENAI_BASE_URL}/images/edits`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
      },
      OPENAI_IMAGE_EDIT_TIMEOUT_MS
    );
  } catch (error) {
    return {
      ok: false,
      status: 504,
      data: {
        error: { message: `OpenAI image edit request failed: ${String(error.message || error)}` },
        _network_error: true
      }
    };
  }

  const data = await readJsonFromResponse(response);
  return { ok: response.ok, status: response.status, data };
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

    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [scriptPath, requestPath], {
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
    return res.status(400).json({ error: "scene first-frame image is required." });
  }

  try {
    const imageUrl = toDataUri(image);
    const imagePreview = summarizeDataUri(imageUrl);
    const directionAttempts = [];
    const directionsRequestBody = {
      model: AUTO_PROMPT_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are an expert TikTok commerce video strategist. Prioritize scenario diversity that best fits the product use cases. Return strict JSON only: {\"directions\":[{\"direction\":\"...\",\"scene_keywords\":[\"...\"],\"characters\":\"...\",\"script\":\"...\"}]}"
        },
        {
          role: "user",
          content: [
            {
                type: "text",
                text:
                `Based on the uploaded clothing reference image, generate exactly ${count} different and independent TikTok commerce scene directions (not a continuous sequence). Each scene must be clearly different in location, social context, and story angle, while still fitting where this product is realistically worn and sold. Prioritize diverse product-fit scenarios across different places (home, outdoor, festive, travel, casual outing, etc.) and different story intents (comfort, elegance, practicality, bonding, gifting, confidence, etc.). Duration target for each video is ${duration} seconds.

For every scene, include:
- direction: one concise but specific scene direction.
- scene_keywords: 6-12 concise keywords/phrases (multi-word allowed) that MUST cover: environment/place, main protagonist type, whether supporting/background people appear (and who they are), story line beat, and age hints.
- characters: clear description of main character(s) + supporting/background people if any, with explicit ages for each person (exact age or tight range, e.g., 29 or 28-32).
- script: a mini storyline summary (setup -> key moment -> selling beat/CTA).

Age requirements:
- include product-suitable age positioning per scene.
- explicitly specify ages of all people in each scene.

Hard requirements for every scene: 1) target TikTok Malaysia; 2) Malay people as characters; 3) Bahasa Melayu voice-over; 4) do NOT reuse the original image background/environment; 5) opening shot must be strong and easy to convert into a first-frame image; 6) no on-screen text, logos, or watermarks.

Return strict JSON only as {"directions":[{"direction":"...","scene_keywords":["..."],"characters":"...","script":"..."}]}.`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    };
    const directionsRequestPreview = {
      endpoint: "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
      model: directionsRequestBody.model,
      temperature: directionsRequestBody.temperature,
      messages: [
        directionsRequestBody.messages[0],
        {
          role: "user",
          content: [
            directionsRequestBody.messages[1].content[0],
            { type: "image_url", image_url: imagePreview }
          ]
        }
      ]
    };

    const directionCall = await callOpenAiChat({
      apiKey: openaiApiKey,
      body: directionsRequestBody
    });
    const directionsResponsePreview = buildOpenAiResponsePreview(directionCall.data);
    if (!directionCall.ok) {
      directionAttempts.push({
        label: "initial",
        request: directionsRequestPreview,
        response: directionsResponsePreview,
        raw: directionCall.data
      });
      return res.status(directionCall.status).json({
        error: directionCall.data?.error?.message || "Failed to generate directions.",
        raw: directionCall.data,
        direction_debug: {
          request: directionsRequestPreview,
          response: directionsResponsePreview,
          raw: directionCall.data,
          attempts: directionAttempts
        }
      });
    }

    const directionsText = extractTextFromOpenAiMessage(directionCall.data);
    let scenes = parseSceneDirections(directionsText, count);
    directionAttempts.push({
      label: "initial",
      request: directionsRequestPreview,
      response: directionsResponsePreview,
      raw: directionCall.data,
      parsed_directions: scenes.map((scene) => scene.direction),
      parsed_scenes: scenes
    });

    if (scenes.length < count) {
      const maxRefillAttempts = 2;
      for (let attempt = 0; attempt < maxRefillAttempts && scenes.length < count; attempt += 1) {
        const missing = count - scenes.length;
        const existing = scenes
          .map((scene, idx) => `${idx + 1}. ${String(scene?.direction || "").trim().slice(0, 280)}`)
          .filter(Boolean)
          .join("\n");

        const refillRequestBody = {
          model: AUTO_PROMPT_MODEL,
          temperature: 0.5,
          messages: [
            directionsRequestBody.messages[0],
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    `You returned too few directions.\n\n` +
                    `Generate EXACTLY ${missing} additional, independent TikTok commerce scene directions.\n` +
                    `They must be NEW and NOT repeat or paraphrase any existing scene directions below.\n` +
                    `Prioritize diverse product-fit scenarios across clearly different places, protagonist setups, presence/absence of supporting people, and storyline angles.\n` +
                    `Include product-suitable age positioning for each scene.\n` +
                    `For every person in the scene (main/support/background), specify explicit age in the characters field (exact age or tight range, e.g., 29 or 28-32).\n` +
                    `Duration target: ${duration} seconds.\n` +
                    `Hard requirements: 1) target TikTok Malaysia; 2) Malay people as characters; 3) Bahasa Melayu voice-over; 4) do NOT reuse the original image background/environment; 5) strong opening shot (easy to turn into a first-frame image); 6) no on-screen text, logos, or watermarks.\n\n` +
                    `Existing scene directions:\n${existing}\n\n` +
                    `Return strict JSON only as {"directions":[{"direction":"...","scene_keywords":["..."],"characters":"...","script":"..."}]} with exactly ${missing} items. scene_keywords must include environment, protagonist, supporting/background people, storyline beat clues, and product-suitable age hints. characters must explicitly include ages for all people mentioned.`
                },
                { type: "image_url", image_url: { url: imageUrl } }
              ]
            }
          ]
        };

        const refillRequestPreview = {
          endpoint: "https://api.openai.com/v1/chat/completions",
          authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
          model: refillRequestBody.model,
          temperature: refillRequestBody.temperature,
          messages: [
            refillRequestBody.messages[0],
            {
              role: "user",
              content: [
                refillRequestBody.messages[1].content[0],
                { type: "image_url", image_url: imagePreview }
              ]
            }
          ]
        };

        const refillCall = await callOpenAiChat({
          apiKey: openaiApiKey,
          body: refillRequestBody
        });
        const refillResponsePreview = buildOpenAiResponsePreview(refillCall.data);

        if (!refillCall.ok) {
          directionAttempts.push({
            label: `refill_${attempt + 1}`,
            request: refillRequestPreview,
            response: refillResponsePreview,
            raw: refillCall.data
          });
          break;
        }

        const refillText = extractTextFromOpenAiMessage(refillCall.data);
        const refillScenes = parseSceneDirections(refillText, missing);
        scenes = mergeUniqueScenes(scenes, refillScenes, count);
        directionAttempts.push({
          label: `refill_${attempt + 1}`,
          request: refillRequestPreview,
          response: refillResponsePreview,
          raw: refillCall.data,
          parsed_directions: refillScenes.map((scene) => scene.direction),
          parsed_scenes: refillScenes
        });
      }
    }

    if (scenes.length < count) {
      return res.status(502).json({
        error: "Failed to generate enough video directions.",
        raw: directionCall.data,
        direction_debug: {
          request: directionsRequestPreview,
          response: directionsResponsePreview,
          raw: directionCall.data,
          attempts: directionAttempts,
          parsed_directions: scenes.map((scene) => scene.direction),
          parsed_scenes: scenes
        }
      });
    }

    return res.json({
      model: AUTO_PROMPT_MODEL,
      directions: scenes.map((scene) => scene.direction),
      scenes,
      prompts: [],
      direction_debug: {
        request: directionsRequestPreview,
        response: directionsResponsePreview,
        raw: directionCall.data,
        attempts: directionAttempts,
        parsed_directions: scenes.map((scene) => scene.direction),
        parsed_scenes: scenes
      },
      prompt_debug: []
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/generate-scene-video-prompt", upload.single("image"), async (req, res) => {
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;
  const duration = normalizeDuration(req.body.duration) || 4;
  let scene = null;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "scene first-frame image is required." });
  }

  try {
    if (req.body.scene) {
      try {
        scene = JSON.parse(String(req.body.scene));
      } catch {
        scene = null;
      }
    }
    if (!scene || typeof scene !== "object") {
      scene = {
        direction: String(req.body.scene_direction || "").trim(),
        scene_keywords: normalizeSceneKeywordList(req.body.scene_keywords || ""),
        characters: String(req.body.characters || "").trim(),
        script: String(req.body.script || "").trim()
      };
    }

    const result = await generateVideoPromptFromScene({
      openaiApiKey,
      imageFile: image,
      scene,
      duration
    });

    return res.json({
      model: AUTO_PROMPT_MODEL,
      scene: result.scene,
      prompt: result.prompt,
      prompt_debug: result.prompt_debug
    });
  } catch (error) {
    const status = Number.isInteger(error.openaiStatus) ? error.openaiStatus : 500;
    return res.status(status).json({
      error: error.message || "Failed to generate scene video prompt.",
      raw: error.openaiRaw || null,
      prompt_debug: error.promptDebug || null
    });
  }
});

app.post("/api/regenerate-scene", upload.single("image"), async (req, res) => {
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;
  const duration = normalizeDuration(req.body.duration) || 4;
  const index = Number.parseInt(String(req.body.index || ""), 10);
  const total = normalizeVideoCount(req.body.total);
  let existingDirections = [];

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }

  try {
    const parsed = JSON.parse(String(req.body.existing_directions || "[]"));
    if (Array.isArray(parsed)) {
      existingDirections = parsed.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20);
    }
  } catch {
    existingDirections = [];
  }

  try {
    const imageUrl = toDataUri(image);
    const imagePreview = summarizeDataUri(imageUrl);
    const existingList = existingDirections.map((item, i) => `${i + 1}. ${item}`).join("\n");

    const directionRequestBody = {
      model: AUTO_PROMPT_MODEL,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are an expert TikTok commerce video strategist. Prioritize scenario diversity that best fits the product use cases. Return strict JSON only: {\"directions\":[{\"direction\":\"...\",\"scene_keywords\":[\"...\"],\"characters\":\"...\",\"script\":\"...\"}]}"
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Regenerate ONE brand-new TikTok commerce scene direction for this clothing product.\n` +
                `It must be different from existing scene directions below.\n` +
                `Prioritize a clearly different product-fit place, protagonist setup, supporting/background people setup, and storyline angle.\n` +
                `Include product-suitable age positioning and explicit ages for all people in the scene.\n` +
                `Duration target: ${duration} seconds.\n` +
                `Hard requirements: 1) target TikTok Malaysia; 2) Malay people as characters; 3) Bahasa Melayu voice-over; 4) do NOT reuse the original image background/environment; 5) strong opening shot suitable for first-frame generation; 6) no on-screen text, logos, or watermarks.\n\n` +
                `Existing scene directions (must avoid overlap):\n${existingList || "(none)"}\n\n` +
                `Return strict JSON only as {"directions":[{"direction":"...","scene_keywords":["..."],"characters":"...","script":"..."}]} with exactly 1 item. scene_keywords must include environment, protagonist, supporting/background people, storyline beat clues, and product-suitable age hints. characters must explicitly include ages for all people mentioned.`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    };

    const directionRequestPreview = {
      endpoint: "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
      model: directionRequestBody.model,
      temperature: directionRequestBody.temperature,
      messages: [
        directionRequestBody.messages[0],
        {
          role: "user",
          content: [
            directionRequestBody.messages[1].content[0],
            { type: "image_url", image_url: imagePreview }
          ]
        }
      ]
    };

    const directionCall = await callOpenAiChat({
      apiKey: openaiApiKey,
      body: directionRequestBody
    });
    const directionResponsePreview = buildOpenAiResponsePreview(directionCall.data);
    if (!directionCall.ok) {
      return res.status(directionCall.status).json({
        error: directionCall.data?.error?.message || "Failed to regenerate scene direction.",
        raw: directionCall.data,
        direction_debug: {
          request: directionRequestPreview,
          response: directionResponsePreview,
          raw: directionCall.data
        }
      });
    }

    const directionText = extractTextFromOpenAiMessage(directionCall.data);
    const parsedScenes = mergeUniqueScenes(parseSceneDirections(directionText, 2), [], 2).filter(
      (scene) => !existingDirections.some((item) => item.toLowerCase() === scene.direction.toLowerCase())
    );
    const scene = parsedScenes[0];

    if (!scene) {
      return res.status(502).json({
        error: "Failed to regenerate a new scene direction.",
        raw: directionCall.data,
        direction_debug: {
          request: directionRequestPreview,
          response: directionResponsePreview,
          raw: directionCall.data,
          parsed_directions: parseSceneDirections(directionText, 2).map((item) => item.direction)
        }
      });
    }

    const promptRequestBody = {
      model: AUTO_PROMPT_MODEL,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "You are an expert TikTok commerce video director. Return one complete production-ready prompt as plain text only. No JSON. No markdown."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Convert this scene direction into one final video-generation prompt:\n${buildSceneBrief(scene)}\n\nThe final prompt must fit ${duration} seconds and include: 1) video concept and hook, 2) Malay model design, 3) scene/background/environment, 4) camera and motion plan, 5) Bahasa Melayu voice-over script paced for ${duration} seconds, 6) selling points and CTA, 7) voice age/tone design aligned to the ages described in scene direction/scene_keywords/characters, 8) one explicit line: "Voice-over speaker age: <exact age or tight range>" chosen as the most suitable voice age for this scene and buying persona. If multiple ages exist in the scene, pick the best primary narrator age and state it explicitly. Mandatory constraints: target TikTok Malaysia, Malay people as characters, Bahasa Melayu voice-over, do NOT reuse the original reference image background/environment, no on-screen text/logos/watermarks, and ensure the opening frame can match a separately generated first-frame image (image-to-video) while keeping the clothing/product consistent with the reference image.`
            },
            {
              type: "image_url",
              image_url: { url: imageUrl }
            }
          ]
        }
      ]
    };

    const promptRequestPreview = {
      endpoint: "https://api.openai.com/v1/chat/completions",
      authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
      model: promptRequestBody.model,
      temperature: promptRequestBody.temperature,
      messages: [
        promptRequestBody.messages[0],
        {
          role: "user",
          content: [
            {
              type: "text",
              text: toPreviewText(promptRequestBody.messages[1].content[0]?.text, 2200)
            },
            { type: "image_url", image_url: imagePreview }
          ]
        }
      ]
    };

    const promptCall = await callOpenAiChat({
      apiKey: openaiApiKey,
      body: promptRequestBody
    });
    const promptResponsePreview = buildOpenAiResponsePreview(promptCall.data);
    if (!promptCall.ok) {
      return res.status(promptCall.status).json({
        error: promptCall.data?.error?.message || "Failed to regenerate prompt.",
        raw: promptCall.data,
        direction_debug: {
          request: directionRequestPreview,
          response: directionResponsePreview,
          raw: directionCall.data,
          parsed_directions: [scene.direction],
          parsed_scenes: [scene]
        },
        prompt_debug: {
          request: promptRequestPreview,
          response: promptResponsePreview,
          raw: promptCall.data
        }
      });
    }

    const prompt = extractPromptFromModelResponse(promptCall.data);
    if (!prompt || prompt === "[object Object]") {
      return res.status(502).json({
        error: "Regenerated prompt is invalid.",
        raw: promptCall.data,
        direction_debug: {
          request: directionRequestPreview,
          response: directionResponsePreview,
          raw: directionCall.data,
          parsed_directions: [scene.direction],
          parsed_scenes: [scene]
        },
        prompt_debug: {
          request: promptRequestPreview,
          response: promptResponsePreview,
          raw: promptCall.data
        }
      });
    }

    return res.json({
      index: Number.isInteger(index) ? index : null,
      total: total || null,
      model: AUTO_PROMPT_MODEL,
      scene,
      prompt,
      direction_debug: {
        request: directionRequestPreview,
        response: directionResponsePreview,
        raw: directionCall.data,
        parsed_directions: [scene.direction],
        parsed_scenes: [scene]
      },
      prompt_debug: {
        request: promptRequestPreview,
        response: promptResponsePreview,
        raw: promptCall.data,
        extracted_prompt_preview: toPreviewText(prompt, 2200)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/process-product-image", upload.single("image"), async (req, res) => {
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }

  try {
    const editPrompt =
      "Remove all people and the original background from this image. Keep only the main product (clothing/product item), centered, with clean edges. Output a studio-like white background product image. Do not add extra objects, text, logos, or watermarks.";

    const requestPreview = {
      endpoint: "https://api.openai.com/v1/images/edits",
      authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
      model: OPENAI_IMAGE_EDIT_MODEL,
      prompt: editPrompt,
      size: "1024x1024",
      quality: "auto",
      input_fidelity: "high",
      input_image: summarizeUploadedFile(image)
    };

    const editCall = await callOpenAiImageEdit({
      apiKey: openaiApiKey,
      imageFile: image,
      prompt: editPrompt
    });
    const coerced = await coerceOpenAiImageDataUri(editCall.data);
    const responsePreview = {
      created: editCall.data?.created || null,
      output_type: coerced.outputType,
      output_url: coerced.outputUrl,
      b64_length: coerced.b64Length
    };

    if (!editCall.ok) {
      return res.status(editCall.status).json({
        error: editCall.data?.error?.message || "Failed to process product image.",
        raw: editCall.data,
        debug: { request: requestPreview, response: responsePreview }
      });
    }
    if (!coerced.dataUri) {
      return res.status(502).json({
        error: "Image processing returned no usable image.",
        raw: editCall.data,
        debug: { request: requestPreview, response: responsePreview }
      });
    }

    return res.json({
      processed_image_data_uri: coerced.dataUri,
      processed_image_mime: detectMimeFromDataUri(coerced.dataUri),
      debug: { request: requestPreview, response: responsePreview }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

function buildFirstFramePrompt(sceneDirection, index, total) {
  const raw = String(sceneDirection || "").trim();
  const clipped =
    raw.length > 2400 ? `${raw.slice(0, 2400)}\n...<truncated>` : raw;
  const tag = Number.isInteger(index) && Number.isInteger(total) ? `Variation ${index + 1}/${total}.` : "";

  return [
    "Generate ONE photorealistic, high-quality STILL IMAGE to be used as the FIRST FRAME for an image-to-video TikTok commerce ad.",
    "The uploaded image is a clothing/product reference. Keep the clothing design, color, and proportions consistent, but create a NEW composition: different pose, different camera angle, and a NEW background/environment (do NOT reuse the original background).",
    "Target TikTok Malaysia. Use Malay people as characters. No on-screen text, logos, watermarks, or brand marks.",
    "Keep the full outfit fully visible (no cropping), centered with even margins. Sharp focus, clean edges, natural lighting, no motion blur.",
    tag,
    "",
    "Video plan (use visual parts only; ignore voice-over):",
    clipped
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateFirstFrameImage({ openaiApiKey, imageFile, sceneDirection, videoPrompt, aspectRatio, index, total }) {
  const size = pickOpenAiImageSizeFromAspectRatio(aspectRatio);
  const prompt = buildFirstFramePrompt(sceneDirection || videoPrompt, index, total);

  const requestPreview = {
    endpoint: "https://api.openai.com/v1/images/edits",
    authorization: `Bearer ${maskApiKey(openaiApiKey)}`,
    model: OPENAI_IMAGE_EDIT_MODEL,
    size,
    quality: "auto",
    input_fidelity: "high",
    prompt_preview: toPreviewText(prompt, 1200),
    input_image: summarizeUploadedFile(imageFile)
  };

  const editCall = await callOpenAiImageEdit({
    apiKey: openaiApiKey,
    imageFile,
    prompt,
    size,
    quality: "auto",
    inputFidelity: "high"
  });

  const coerced = await coerceOpenAiImageDataUri(editCall.data);
  const responsePreview = {
    created: editCall.data?.created || null,
    output_type: coerced.outputType,
    output_url: coerced.outputUrl,
    b64_length: coerced.b64Length
  };

  if (!editCall.ok) {
    const message = editCall.data?.error?.message || "Failed to generate first-frame image.";
    const err = new Error(message);
    err.openaiStatus = editCall.status;
    err.openaiRaw = editCall.data;
    err.debug = { request: requestPreview, response: responsePreview };
    throw err;
  }

  if (!coerced.dataUri) {
    const err = new Error("First-frame image generation returned no usable image.");
    err.openaiStatus = 502;
    err.openaiRaw = editCall.data;
    err.debug = { request: requestPreview, response: responsePreview };
    throw err;
  }

  return {
    dataUri: coerced.dataUri,
    mime: detectMimeFromDataUri(coerced.dataUri),
    prompt,
    debug: { request: requestPreview, response: responsePreview }
  };
}

app.post("/api/generate-first-frames", upload.single("image"), async (req, res) => {
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;
  const aspectRatio = String(req.body.aspect_ratio || "auto").trim();

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }

  let prompts = [];
  try {
    prompts = JSON.parse(String(req.body.prompts || "[]"));
  } catch {
    prompts = [];
  }
  if (!Array.isArray(prompts) || !prompts.length) {
    return res.status(400).json({ error: "prompts must be a non-empty JSON array." });
  }

  const normalizedPrompts = prompts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!normalizedPrompts.length) {
    return res.status(400).json({ error: "prompts must include at least one non-empty entry." });
  }

  try {
    const frames = [];
    for (let i = 0; i < normalizedPrompts.length; i += 1) {
      const result = await generateFirstFrameImage({
        openaiApiKey,
        imageFile: image,
        videoPrompt: normalizedPrompts[i],
        aspectRatio,
        index: i,
        total: normalizedPrompts.length
      });
      frames.push({
        index: i + 1,
        first_frame_data_uri: result.dataUri,
        first_frame_mime: result.mime,
        first_frame_prompt: result.prompt,
        debug: result.debug
      });
    }

    return res.json({
      model: OPENAI_IMAGE_EDIT_MODEL,
      size: pickOpenAiImageSizeFromAspectRatio(aspectRatio),
      frames
    });
  } catch (error) {
    const status = Number.isInteger(error.openaiStatus) ? error.openaiStatus : 500;
    return res.status(status).json({
      error: error.message || "Failed to generate first-frame images.",
      raw: error.openaiRaw || null,
      debug: error.debug || null
    });
  }
});

app.post("/api/generate-first-frame", upload.single("image"), async (req, res) => {
  const openaiApiKey = String(req.body.openai_api_key || "").trim();
  const image = req.file;
  const aspectRatio = String(req.body.aspect_ratio || "auto").trim();
  const sceneDirection = String(req.body.scene_direction || "").trim();
  const videoPrompt = String(req.body.prompt || "").trim();
  const index = Number.parseInt(String(req.body.index || ""), 10);
  const total = Number.parseInt(String(req.body.total || ""), 10);

  if (!openaiApiKey) {
    return res.status(400).json({ error: "openai_api_key is required." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
  }
  if (!videoPrompt && !sceneDirection) {
    return res.status(400).json({ error: "scene_direction or prompt is required." });
  }

  try {
    const result = await generateFirstFrameImage({
      openaiApiKey,
      imageFile: image,
      sceneDirection,
      videoPrompt,
      aspectRatio,
      index: Number.isInteger(index) ? index : null,
      total: Number.isInteger(total) ? total : null
    });

    return res.json({
      model: OPENAI_IMAGE_EDIT_MODEL,
      size: pickOpenAiImageSizeFromAspectRatio(aspectRatio),
      first_frame_data_uri: result.dataUri,
      first_frame_mime: result.mime,
      first_frame_prompt: result.prompt,
      debug: result.debug
    });
  } catch (error) {
    const status = Number.isInteger(error.openaiStatus) ? error.openaiStatus : 500;
    return res.status(status).json({
      error: error.message || "Failed to generate first-frame image.",
      raw: error.openaiRaw || null,
      debug: error.debug || null
    });
  }
});

app.post("/api/generate-video", upload.single("image"), async (req, res) => {
  const apiKey = String(req.body.api_key || "").trim();
  if (!apiKey) {
    return res.status(400).json({ error: "api_key is required." });
  }

  const prompt = String(req.body.prompt || "").trim();
  const finalPrompt = `${VIDEO_PROMPT_APPEND}\n\n${prompt}`.trim();
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
  let requestPreview = null;

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
    requestPreview = {
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
        request_preview: requestPreview,
        raw: sdkResult?.raw || sdkResult
      });
    }

    return res.json({
      status: "done",
      video_url: videoUrl,
      final_prompt: finalPrompt,
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
        : message,
      request_preview: requestPreview
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
