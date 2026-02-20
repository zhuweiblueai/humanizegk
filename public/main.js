const statusBox = document.getElementById("statusBox");
const historyList = document.getElementById("historyList");
const historyPanel = document.getElementById("historyPanel");
const toggleHistoryBtn = document.getElementById("toggleHistoryBtn");
const firstFrameList = document.getElementById("firstFrameList");
const modelDebugBox = document.getElementById("modelDebugBox");
const modelDebugSection = document.getElementById("modelDebugSection");

const step1Panel = document.getElementById("step1Panel");
const step2Panel = document.getElementById("step2Panel");
const step3Panel = document.getElementById("step3Panel");

const tabStep1 = document.getElementById("tabStep1");
const tabStep2 = document.getElementById("tabStep2");
const tabStep3 = document.getElementById("tabStep3");

const openaiApiKeyInput = document.getElementById("openaiApiKeyInput");
const xaiApiKeyInput = document.getElementById("xaiApiKeyInput");
const toStep2Btn = document.getElementById("toStep2Btn");

const imageInput = document.getElementById("imageInput");
const videoCountInput = document.getElementById("videoCountInput");
const durationSelect = document.getElementById("durationSelect");
const resolutionSelect = document.getElementById("resolutionSelect");
const aspectRatioSelect = document.getElementById("aspectRatioSelect");
const generatePromptsBtn = document.getElementById("generatePromptsBtn");

const summaryText = document.getElementById("summaryText");
const referencePreview = document.getElementById("referencePreview");
const clearDebugBtn = document.getElementById("clearDebugBtn");
const imageZoomModal = document.getElementById("imageZoomModal");
const closeImageZoomBtn = document.getElementById("closeImageZoomBtn");
const zoomedImage = document.getElementById("zoomedImage");

const HISTORY_KEY = "humanize_grok_video_history";

const state = {
  step: 1,
  busy: false,
  openaiApiKey: "",
  xaiApiKey: "",
  imageFile: null,
  preparedPrompts: [],
  scenePlans: [],
  firstFrames: [],
  firstFrameStatuses: [],
  firstFrameTasks: [],
  videoStatuses: [],
  sceneVideos: [],
  historyExpanded: false,
  modelDebugEvents: [],
  advancedPanelsVisible: false
};

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden", "error");
  if (type === "error") statusBox.classList.add("error");
}

function clearStatus() {
  statusBox.classList.add("hidden");
  statusBox.textContent = "";
  statusBox.classList.remove("error");
}

function setBusy(busy) {
  state.busy = busy;
  toStep2Btn.disabled = busy;
  generatePromptsBtn.disabled = busy;
  if (toggleHistoryBtn) toggleHistoryBtn.disabled = busy;
  if (clearDebugBtn) clearDebugBtn.disabled = busy;
  generatePromptsBtn.textContent = busy ? "Processing..." : "Generate Prompts";
}

function applyAdvancedPanelsVisibility() {
  if (modelDebugSection) {
    modelDebugSection.classList.toggle("hidden", !state.advancedPanelsVisible);
  }
}

function getVideoCount() {
  const value = Number.parseInt(String(videoCountInput.value || ""), 10);
  if (!Number.isInteger(value)) return 3;
  return Math.max(1, Math.min(8, value));
}

function normalizePromptText(input) {
  if (typeof input === "string") return input.trim();
  if (input == null) return "";
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  try {
    return JSON.stringify(input, null, 2).trim();
  } catch {
    return "";
  }
}

function normalizeKeywordList(value) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，/|;、\n]/g)
      : [];
  const dedup = [];
  const seen = new Set();
  items.forEach((item) => {
    const text = String(item || "").trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    dedup.push(text);
  });
  return dedup.slice(0, 8);
}

function normalizeScenePlanEntry(scene, prompt) {
  const direction = normalizePromptText(scene?.direction || scene?.scene_direction || "");
  return {
    direction,
    scene_keywords: normalizeKeywordList(scene?.scene_keywords || scene?.keywords || []),
    characters: normalizePromptText(scene?.characters || scene?.character || ""),
    script: normalizePromptText(scene?.script || scene?.voiceover || ""),
    prompt: normalizePromptText(prompt)
  };
}

function safeJsonStringify(value, maxStringLen = 4200) {
  const seen = new WeakSet();
  return JSON.stringify(
    value,
    (key, val) => {
      if (typeof val === "string" && val.length > maxStringLen) {
        return `${val.slice(0, maxStringLen)}\n...<truncated>`;
      }
      if (val && typeof val === "object") {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    },
    2
  );
}

function renderModelDebug() {
  if (!modelDebugBox) return;
  modelDebugBox.innerHTML = "";
  if (!state.modelDebugEvents.length) {
    modelDebugBox.innerHTML = '<p class="muted">No model requests yet.</p>';
    return;
  }

  const pre = document.createElement("pre");
  pre.className = "prompt-preview";
  pre.textContent = safeJsonStringify(state.modelDebugEvents);
  modelDebugBox.appendChild(pre);
  requestAnimationFrame(() => {
    pre.scrollTop = pre.scrollHeight;
  });
}

function clearModelDebug() {
  state.modelDebugEvents = [];
  renderModelDebug();
}

function addModelDebugEvent(event) {
  const entry = {
    at: new Date().toISOString(),
    ...event
  };
  state.modelDebugEvents.push(entry);
  state.modelDebugEvents = state.modelDebugEvents.slice(-120);
  renderModelDebug();
}

function logDirectionDebug(directionDebug, errorMessage) {
  if (!directionDebug) return;
  const attempts = Array.isArray(directionDebug.attempts) ? directionDebug.attempts : [];

  if (attempts.length) {
    attempts.forEach((attempt, idx) => {
      addModelDebugEvent({
        provider: "openai",
        operation: `chat/completions (directions ${attempt.label || idx + 1})`,
        request: attempt.request || null,
        response: {
          ...(attempt.response || {}),
          raw: attempt.raw || null,
          parsed_directions: attempt.parsed_directions || null
        },
        ...(errorMessage ? { error: errorMessage } : {})
      });
    });

    if (attempts.length > 1 || Array.isArray(directionDebug.parsed_directions)) {
      addModelDebugEvent({
        provider: "openai",
        operation: "chat/completions (directions merged)",
        request: directionDebug.request || null,
        response: {
          ...(directionDebug.response || {}),
          raw: directionDebug.raw || null,
          parsed_directions: directionDebug.parsed_directions || []
        },
        ...(errorMessage ? { error: errorMessage } : {})
      });
    }
    return;
  }

  addModelDebugEvent({
    provider: "openai",
    operation: "chat/completions (directions)",
    request: directionDebug.request || null,
    response: {
      ...(directionDebug.response || {}),
      raw: directionDebug.raw || null,
      parsed_directions: directionDebug.parsed_directions || []
    },
    ...(errorMessage ? { error: errorMessage } : {})
  });
}

function switchStep(targetStep) {
  state.step = targetStep;
  step1Panel.classList.toggle("hidden", targetStep !== 1);
  step2Panel.classList.toggle("hidden", targetStep !== 2);
  step3Panel.classList.toggle("hidden", targetStep !== 3);

  tabStep1.classList.toggle("active", targetStep === 1);
  tabStep2.classList.toggle("active", targetStep === 2);
  tabStep3.classList.toggle("active", targetStep === 3);
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function setHistoryExpanded(expanded) {
  state.historyExpanded = Boolean(expanded);
  if (historyPanel) historyPanel.classList.toggle("hidden", !state.historyExpanded);
  if (toggleHistoryBtn) {
    const count = getHistory().length;
    toggleHistoryBtn.textContent = state.historyExpanded ? `Hide (${count})` : `History (${count})`;
  }
}

async function downloadVideoFile(videoUrl) {
  setStatus("Preparing download...");
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error("Failed to fetch video file.");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = `generated-video-${Date.now()}.mp4`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
  setStatus("Download started.");
}

function renderHistory() {
  const history = getHistory();
  if (toggleHistoryBtn) {
    toggleHistoryBtn.textContent = state.historyExpanded ? `Hide (${history.length})` : `History (${history.length})`;
  }
  historyList.innerHTML = "";
  if (!history.length) {
    historyList.innerHTML = '<p class="muted">No generated videos yet.</p>';
    return;
  }

  history.forEach((item) => {
    const card = document.createElement("article");
    card.className = "history-card";

    const title = document.createElement("h3");
    title.textContent = new Date(item.created_at).toLocaleString();

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${item.duration}s / ${item.resolution} / ${item.aspect_ratio}`;

    const promptTitle = document.createElement("p");
    promptTitle.className = "muted";
    promptTitle.textContent = `Prompt sent to Grok${item.prompt_index ? ` #${item.prompt_index}` : ""}:`;

    const promptPreview = document.createElement("pre");
    promptPreview.className = "prompt-preview";
    promptPreview.textContent = item.final_prompt || item.prompt || "(no prompt recorded)";

    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.src = item.video_url;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const openLink = document.createElement("a");
    openLink.href = item.video_url;
    openLink.target = "_blank";
    openLink.rel = "noreferrer";
    openLink.textContent = "Open";

    const downloadLinkEl = document.createElement("a");
    downloadLinkEl.href = "#";
    downloadLinkEl.textContent = "Download";
    downloadLinkEl.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await downloadVideoFile(item.video_url);
      } catch (error) {
        setStatus(`Download failed: ${error.message}`, "error");
      }
    });

    actions.append(openLink, downloadLinkEl);
    card.append(title, meta, promptTitle, promptPreview, video, actions);
    historyList.appendChild(card);
  });
}

function getLatestSceneVideo(index) {
  if (!Array.isArray(state.sceneVideos)) return null;
  return state.sceneVideos[index] || null;
}

function renderFirstFrames() {
  firstFrameList.innerHTML = "";

  if (!state.scenePlans.length) {
    firstFrameList.innerHTML = '<p class="muted">Generate scene directions first.</p>';
    return;
  }

  const count = state.scenePlans.length;
  for (let i = 0; i < count; i += 1) {
    const plan = state.scenePlans[i] || normalizeScenePlanEntry({}, "");
    const card = document.createElement("article");
    card.className = "first-frame-card";

    const title = document.createElement("p");
    title.className = "muted";
    title.textContent = `Scene #${i + 1}`;

    const directionTitle = document.createElement("p");
    directionTitle.className = "muted";
    directionTitle.textContent = "Scene Direction";

    const directionContent = document.createElement("pre");
    directionContent.className = "prompt-preview";
    directionContent.textContent = normalizePromptText(plan.direction || "(missing scene direction)");

    const keywords = document.createElement("p");
    keywords.className = "muted";
    keywords.textContent = `Scene Keywords: ${plan.scene_keywords?.length ? plan.scene_keywords.join(", ") : "(none)"}`;

    const imagePromptTitle = document.createElement("p");
    imagePromptTitle.className = "muted";
    imagePromptTitle.textContent = "Image Prompt";

    const frame = state.firstFrames?.[i] || {};
    const imagePromptText =
      normalizePromptText(frame.prompt) ||
      normalizePromptText(frame?.debug?.request?.prompt) ||
      normalizePromptText(frame?.debug?.request?.prompt_preview) ||
      "(image prompt not generated yet)";

    const imagePromptContent = document.createElement("pre");
    imagePromptContent.className = "prompt-preview";
    imagePromptContent.textContent = imagePromptText;
    imagePromptTitle.classList.toggle("hidden", !state.advancedPanelsVisible);
    imagePromptContent.classList.toggle("hidden", !state.advancedPanelsVisible);

    const hasImage = typeof frame.dataUri === "string" && frame.dataUri.length;
    const frameStatus = state.firstFrameStatuses?.[i] || (hasImage ? "done" : "idle");
    const videoStatus = state.videoStatuses?.[i] || "idle";
    const imageGenerating = frameStatus === "generating";
    const videoBusy = videoStatus === "prompting" || videoStatus === "generating";

    const frameZone = document.createElement("div");
    frameZone.className = "frame-click-zone";

    const img = document.createElement("img");
    img.className = "first-frame-preview";
    img.alt = `first frame ${i + 1}`;
    img.src = hasImage ? frame.dataUri : "";
    img.classList.toggle("hidden", !hasImage);

    const placeholder = document.createElement("p");
    placeholder.className = "muted";
    placeholder.textContent = hasImage ? "" : "No first-frame image yet.";
    placeholder.classList.toggle("hidden", hasImage);

    frameZone.addEventListener("click", async () => {
      if (imageGenerating || videoBusy) return;
      if (hasImage) {
        openImageZoom(frame.dataUri);
        return;
      }
      try {
        if (!Array.isArray(state.firstFrameStatuses)) state.firstFrameStatuses = [];
        state.firstFrameStatuses[i] = "generating";
        renderFirstFrames();
        await generateFirstFrameAtIndex(i, { force: true });
        state.firstFrameStatuses[i] = "done";
        setStatus(`Generated first frame #${i + 1}.`);
      } catch (error) {
        state.firstFrameStatuses[i] = "error";
        setStatus(`Error: ${error.message}`, "error");
      } finally {
        renderFirstFrames();
      }
    });

    const status = document.createElement("p");
    status.className = "frame-status";
    if (frameStatus === "generating") {
      status.classList.add("generating");
      status.innerHTML = '<span class="frame-spinner" aria-hidden="true"></span><span>Generating...</span>';
    } else if (frameStatus === "waiting") {
      status.classList.add("waiting");
      status.textContent = "Waiting...";
    } else if (frameStatus === "error") {
      status.classList.add("error");
      status.textContent = "Frame generation failed";
    } else if (frameStatus === "done") {
      status.classList.add("done");
      status.textContent = "Frame ready";
    } else {
      status.classList.add("idle");
      status.textContent = "Frame not generated";
    }

    const videoStep = document.createElement("p");
    videoStep.className = "video-step-status";
    if (videoStatus === "prompting") {
      videoStep.textContent = "Video Step 1/2: Generating prompt from scene + frame...";
      videoStep.classList.remove("hidden");
    } else if (videoStatus === "generating") {
      videoStep.textContent = "Video Step 2/2: Generating video from prompt + frame...";
      videoStep.classList.remove("hidden");
    } else if (videoStatus === "done") {
      videoStep.textContent = "Video generated.";
      videoStep.classList.remove("hidden");
    } else if (videoStatus === "error") {
      videoStep.textContent = "Video generation failed.";
      videoStep.classList.remove("hidden");
    } else {
      videoStep.classList.add("hidden");
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const regen = document.createElement("button");
    regen.type = "button";
    regen.className = "secondary-btn";
    regen.textContent = "Regenerate";
    regen.disabled = imageGenerating || videoBusy;
    regen.addEventListener("click", async () => {
      if (imageGenerating || videoBusy) return;
      try {
        await regenerateFirstFrame(i);
        setStatus(`Replaced first frame #${i + 1}.`);
      } catch (error) {
        setStatus(`Error: ${error.message}`, "error");
      }
    });

    const generate = document.createElement("button");
    generate.type = "button";
    generate.textContent = videoBusy ? "Generating..." : "Generate Video";
    generate.disabled = imageGenerating || videoBusy;
    generate.addEventListener("click", async () => {
      if (imageGenerating || videoBusy) return;
      try {
        await generateVideoForIndex(i);
      } catch (error) {
        setStatus(`Error: ${error.message}`, "error");
      }
    });

    const videoPromptTitle = document.createElement("p");
    videoPromptTitle.className = "muted";
    videoPromptTitle.textContent = "Video Prompt";

    const videoPromptContent = document.createElement("pre");
    videoPromptContent.className = "prompt-preview";
    videoPromptContent.textContent = normalizePromptText(plan.prompt || "(video prompt not generated yet)");
    videoPromptTitle.classList.toggle("hidden", !state.advancedPanelsVisible);
    videoPromptContent.classList.toggle("hidden", !state.advancedPanelsVisible);

    const latestVideo = getLatestSceneVideo(i);
    const videoTitle = document.createElement("p");
    videoTitle.className = "muted";
    videoTitle.textContent = "Generated Video";

    const videoWrap = document.createElement("div");
    if (latestVideo?.video_url) {
      const videoEl = document.createElement("video");
      videoEl.controls = true;
      videoEl.playsInline = true;
      videoEl.src = latestVideo.video_url;

      const videoActions = document.createElement("div");
      videoActions.className = "history-actions";

      const openLink = document.createElement("a");
      openLink.href = latestVideo.video_url;
      openLink.target = "_blank";
      openLink.rel = "noreferrer";
      openLink.textContent = "Open";

      const downloadLink = document.createElement("a");
      downloadLink.href = "#";
      downloadLink.textContent = "Download";
      downloadLink.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await downloadVideoFile(latestVideo.video_url);
        } catch (error) {
          setStatus(`Download failed: ${error.message}`, "error");
        }
      });

      videoActions.append(openLink, downloadLink);
      videoWrap.append(videoEl, videoActions);
    } else {
      const noVideo = document.createElement("p");
      noVideo.className = "muted";
      noVideo.textContent = "No video generated yet.";
      videoWrap.appendChild(noVideo);
    }

    frameZone.append(img, placeholder);
    actions.append(regen, generate);
    card.append(
      title,
      directionTitle,
      directionContent,
      keywords,
      imagePromptTitle,
      imagePromptContent,
      frameZone,
      status,
      videoStep,
      actions,
      videoPromptTitle,
      videoPromptContent,
      videoTitle,
      videoWrap
    );
    firstFrameList.appendChild(card);
  }
}

function prependHistoryItem(item) {
  const history = getHistory();
  history.unshift(item);
  saveHistory(history.slice(0, 30));
  renderHistory();
}

function renderPromptPlan() {
  renderFirstFrames();
}

function renderSnapshot() {
  const imageName = state.imageFile?.name || "No image selected";
  const frameReadyCount = (state.firstFrames || []).filter((f) => typeof f?.dataUri === "string" && f.dataUri)
    .length;
  summaryText.textContent = [
    `Reference: ${imageName}`,
    `First Frames: ${frameReadyCount}/${state.preparedPrompts.length || 0}`,
    `Video Count: ${getVideoCount()}`,
    `Duration: ${durationSelect.value}s`,
    `Resolution: ${resolutionSelect.value}`,
    `Aspect Ratio: ${aspectRatioSelect.value}`
  ].join(" | ");
}

function updateReferencePreview(file) {
  if (!file) {
    referencePreview.src = "";
    referencePreview.classList.add("hidden");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  referencePreview.src = objectUrl;
  referencePreview.classList.remove("hidden");
  referencePreview.onload = () => URL.revokeObjectURL(objectUrl);
}

function dataUriToBlob(dataUri) {
  const [head, base64] = String(dataUri || "").split(",");
  const mimeMatch = String(head || "").match(/^data:([^;]+);base64$/);
  if (!mimeMatch || !base64) return null;
  const mime = mimeMatch[1];
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function openImageZoom(dataUri) {
  if (!imageZoomModal || !zoomedImage) return;
  zoomedImage.src = dataUri;
  imageZoomModal.classList.remove("hidden");
}

function closeImageZoom() {
  if (!imageZoomModal || !zoomedImage) return;
  zoomedImage.src = "";
  imageZoomModal.classList.add("hidden");
}

async function createVideoWithFormData(formData, index) {
  const res = await fetch("/api/generate-video", {
    method: "POST",
    body: formData
  });
  const data = await res.json();
  if (!res.ok) {
    addModelDebugEvent({
      provider: "xai",
      operation: `video.generate (video #${(index ?? 0) + 1})`,
      request: data?.request_preview || null,
      response: data?.raw || data || null,
      error: data?.error || "Failed to generate video."
    });
    throw new Error(data.error || "Failed to generate video.");
  }
  if (!data.video_url) throw new Error("No video URL returned.");

  addModelDebugEvent({
    provider: "xai",
    operation: `video.generate (video #${(index ?? 0) + 1})`,
    request: data.request_preview || null,
    response: {
      status: data.status || null,
      video_url: data.video_url,
      duration: data.duration,
      resolution: data.resolution,
      aspect_ratio: data.aspect_ratio,
      image_preprocess: data.image_preprocess || null,
      raw: data.raw || null
    }
  });

  return data;
}

function buildVideoFormData(promptText, promptIndex) {
  const formData = new FormData();
  formData.append("api_key", state.xaiApiKey);
  formData.append("prompt", promptText);
  formData.append("duration", durationSelect.value);
  formData.append("resolution", resolutionSelect.value);
  formData.append("aspect_ratio", aspectRatioSelect.value);

  const frame = state.firstFrames?.[promptIndex] || {};
  if (!frame?.dataUri) {
    throw new Error(`First frame #${promptIndex + 1} is missing. Generate first frames first.`);
  }

  const blob = dataUriToBlob(frame.dataUri);
  if (!blob) {
    throw new Error(`First frame #${promptIndex + 1} is invalid.`);
  }
  formData.append("image", blob, `first-frame-${promptIndex + 1}.png`);

  return formData;
}

async function requestFirstFrameAtIndex(index, { force = false } = {}) {
  if (!state.imageFile) throw new Error("Reference image is required.");
  if (!state.preparedPrompts.length) {
    throw new Error("No generated scenes found. Please run Generate Prompts first.");
  }

  const scenePlan = state.scenePlans?.[index] || {};
  const sceneDirection = normalizePromptText(scenePlan.direction || "");
  const promptText = state.preparedPrompts[index];
  if (!sceneDirection && !promptText) throw new Error(`Scene #${index + 1} is missing.`);

  const existing = state.firstFrames?.[index];
  if (!force && existing?.dataUri) return existing;

  const reqData = new FormData();
  reqData.append("openai_api_key", state.openaiApiKey);
  reqData.append("aspect_ratio", aspectRatioSelect.value);
  reqData.append("scene_direction", sceneDirection);
  reqData.append("scene_keywords", JSON.stringify(scenePlan.scene_keywords || []));
  reqData.append("prompt", promptText);
  reqData.append("index", String(index));
  reqData.append("total", String(state.preparedPrompts.length));
  reqData.append("image", state.imageFile, state.imageFile.name);

  addModelDebugEvent({
    provider: "openai",
    operation: `images/edits (first frame #${index + 1})`,
    stage: "request_sent"
  });

  const res = await fetch("/api/generate-first-frame", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();
  if (!res.ok) {
    if (data?.debug) {
      addModelDebugEvent({
        provider: "openai",
        operation: `images/edits (first frame #${index + 1})`,
        request: data.debug.request || null,
        response: data.debug.response || null,
        error: data.error || "Failed to generate first frame."
      });
    }
    throw new Error(data.error || "Failed to generate first frame.");
  }

  const frame = {
    dataUri: data.first_frame_data_uri || null,
    mime: data.first_frame_mime || null,
    prompt: normalizePromptText(data.first_frame_prompt || data?.debug?.request?.prompt || data?.debug?.request?.prompt_preview || ""),
    debug: data.debug || null
  };

  if (data?.debug) {
    addModelDebugEvent({
      provider: "openai",
      operation: `images/edits (first frame #${index + 1})`,
      request: data.debug.request || null,
      response: data.debug.response || null
    });
  }

  state.firstFrames[index] = frame;
  return frame;
}

async function generateFirstFrameAtIndex(index, { force = false } = {}) {
  if (state.firstFrameTasks[index]) return state.firstFrameTasks[index];
  const task = (async () => {
    try {
      return await requestFirstFrameAtIndex(index, { force });
    } finally {
      state.firstFrameTasks[index] = null;
    }
  })();
  state.firstFrameTasks[index] = task;
  return task;
}

async function generateFirstFrames(force = false) {
  if (!state.imageFile) throw new Error("Reference image is required.");
  if (!state.preparedPrompts.length) {
    throw new Error("No generated scenes found. Please run Generate Prompts first.");
  }

  const total = state.preparedPrompts.length;
  const existing = Array.isArray(state.firstFrames) ? state.firstFrames : [];
  const normalized = new Array(total)
    .fill(null)
    .map((_, idx) => existing[idx] || { dataUri: null, mime: null, prompt: null, debug: null });
  state.firstFrames = force ? normalized.map(() => ({ dataUri: null, mime: null, prompt: null, debug: null })) : normalized;
  state.firstFrameStatuses = new Array(total).fill("idle");
  state.firstFrameTasks = new Array(total).fill(null);

  const ready =
    state.firstFrames.length === total &&
    state.firstFrames.every((f) => typeof f?.dataUri === "string" && f.dataUri);
  if (!force && ready) return;

  const indicesToGenerate = [];
  for (let i = 0; i < total; i += 1) {
    const done = !force && state.firstFrames[i]?.dataUri;
    state.firstFrameStatuses[i] = done ? "done" : "waiting";
    if (!done) indicesToGenerate.push(i);
  }

  if (!indicesToGenerate.length) return;

  let finished = 0;
  setStatus(`Generating first-frame images (0/${indicesToGenerate.length})...`);
  renderFirstFrames();
  renderSnapshot();

  const tasks = indicesToGenerate.map(async (i) => {
    state.firstFrameStatuses[i] = "generating";
    renderFirstFrames();
    try {
      await generateFirstFrameAtIndex(i, { force: true });
      state.firstFrameStatuses[i] = "done";
    } catch (error) {
      state.firstFrameStatuses[i] = "error";
      throw error;
    } finally {
      finished += 1;
      setStatus(`Generating first-frame images (${finished}/${indicesToGenerate.length})...`);
      renderFirstFrames();
      renderSnapshot();
    }
  });

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    throw new Error(`Failed to generate ${failed} first-frame image(s).`);
  }
}

async function requestRegeneratedSceneAtIndex(index) {
  if (!state.imageFile) throw new Error("Reference image is required.");
  const total = state.preparedPrompts.length;
  if (!total) throw new Error("No generated scenes found. Please run Generate Prompts first.");

  const existingDirections = (state.scenePlans || [])
    .map((scene, i) => (i === index ? "" : normalizePromptText(scene?.direction || "")))
    .filter(Boolean);

  const reqData = new FormData();
  reqData.append("openai_api_key", state.openaiApiKey);
  reqData.append("image", state.imageFile, state.imageFile.name);
  reqData.append("duration", durationSelect.value);
  reqData.append("index", String(index));
  reqData.append("total", String(total));
  reqData.append("existing_directions", JSON.stringify(existingDirections));

  const res = await fetch("/api/regenerate-scene", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();

  if (data?.direction_debug) {
    logDirectionDebug(data.direction_debug, !res.ok ? data.error || "Failed to regenerate scene." : undefined);
  }
  if (data?.prompt_debug) {
    addModelDebugEvent({
      provider: "openai",
      operation: `chat/completions (scene prompt regenerate #${index + 1})`,
      request: data.prompt_debug.request || null,
      response: { ...(data.prompt_debug.response || {}), raw: data.prompt_debug.raw || null },
      ...(!res.ok && data.error ? { error: data.error } : {})
    });
  }

  if (!res.ok) {
    throw new Error(data.error || "Failed to regenerate scene.");
  }

  const direction = normalizePromptText(data?.scene?.direction || data?.scene?.scene_direction || "");
  if (!direction) {
    throw new Error("Regenerated scene is incomplete.");
  }

  const nextScene = normalizeScenePlanEntry(data.scene, "");
  state.scenePlans[index] = nextScene;
  state.preparedPrompts[index] = "";
  state.firstFrames[index] = { dataUri: null, mime: null, prompt: null, debug: null };
  state.videoStatuses[index] = "idle";
  if (!Array.isArray(state.sceneVideos)) state.sceneVideos = [];
  state.sceneVideos[index] = null;
  renderPromptPlan();
}

async function requestVideoPromptAtIndex(index) {
  const scene = state.scenePlans?.[index] || null;
  if (!scene?.direction) {
    throw new Error(`Scene #${index + 1} is missing.`);
  }
  const frame = state.firstFrames?.[index] || null;
  const frameDataUri = typeof frame?.dataUri === "string" ? frame.dataUri : "";
  if (!frameDataUri) {
    throw new Error(`Scene #${index + 1} frame image is required before generating video prompt.`);
  }
  const frameBlob = dataUriToBlob(frameDataUri);
  if (!frameBlob) {
    throw new Error(`Scene #${index + 1} frame image is invalid.`);
  }

  const reqData = new FormData();
  reqData.append("openai_api_key", state.openaiApiKey);
  reqData.append("duration", durationSelect.value);
  reqData.append("scene", JSON.stringify({
    direction: scene.direction,
    scene_keywords: scene.scene_keywords || [],
    characters: scene.characters || "",
    script: scene.script || ""
  }));
  reqData.append("image", frameBlob, `scene-${index + 1}-first-frame.png`);

  const res = await fetch("/api/generate-scene-video-prompt", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();

  if (data?.prompt_debug) {
    addModelDebugEvent({
      provider: "openai",
      operation: `chat/completions (scene video prompt #${index + 1})`,
      request: data.prompt_debug.request || null,
      response: { ...(data.prompt_debug.response || {}), raw: data.prompt_debug.raw || null },
      ...(!res.ok && data.error ? { error: data.error } : {})
    });
  }

  if (!res.ok) {
    throw new Error(data.error || "Failed to generate scene video prompt.");
  }

  const prompt = normalizePromptText(data.prompt);
  if (!prompt) throw new Error(`Scene #${index + 1} video prompt is invalid.`);
  if (!Array.isArray(state.preparedPrompts)) state.preparedPrompts = [];
  state.preparedPrompts[index] = prompt;
  if (Array.isArray(state.scenePlans) && state.scenePlans[index]) {
    state.scenePlans[index].prompt = prompt;
  }
  renderPromptPlan();
  return prompt;
}

async function regenerateFirstFrame(index) {
  setStatus(`Regenerating first frame #${index + 1}...`);
  if (!Array.isArray(state.firstFrameStatuses)) state.firstFrameStatuses = [];
  state.firstFrameStatuses[index] = "generating";
  renderFirstFrames();
  renderSnapshot();
  try {
    await requestRegeneratedSceneAtIndex(index);
    await generateFirstFrameAtIndex(index, { force: true });
    state.firstFrameStatuses[index] = "done";
  } catch (error) {
    state.firstFrameStatuses[index] = "error";
    throw error;
  } finally {
    renderFirstFrames();
    renderSnapshot();
  }
}

async function generateVideoForIndex(index) {
  if (!state.preparedPrompts.length) {
    throw new Error("No generated scenes found. Please run Generate Prompts first.");
  }
  if (!Array.isArray(state.videoStatuses)) state.videoStatuses = [];
  if (state.videoStatuses[index] === "prompting" || state.videoStatuses[index] === "generating") {
    throw new Error(`Video #${index + 1} is already generating.`);
  }

  if (!state.firstFrames[index]?.dataUri) {
    setStatus(`Generating first frame #${index + 1}...`);
    if (!Array.isArray(state.firstFrameStatuses)) state.firstFrameStatuses = [];
    state.firstFrameStatuses[index] = "generating";
    renderFirstFrames();
    try {
      await generateFirstFrameAtIndex(index, { force: true });
      state.firstFrameStatuses[index] = "done";
    } catch (error) {
      state.firstFrameStatuses[index] = "error";
      throw error;
    }
    renderFirstFrames();
    renderSnapshot();
  }

  state.videoStatuses[index] = "prompting";
  renderFirstFrames();
  setStatus(`Video Step 1/2: Generating prompt for scene #${index + 1} from scene direction + frame...`);

  let promptText = "";
  try {
    promptText = await requestVideoPromptAtIndex(index);
  } catch (error) {
    state.videoStatuses[index] = "error";
    renderFirstFrames();
    throw error;
  }

  state.videoStatuses[index] = "generating";
  renderFirstFrames();
  setStatus(`Video Step 2/2: Generating video for frame #${index + 1} using prompt + frame...`);
  try {
    const formData = buildVideoFormData(promptText, index);
    const data = await createVideoWithFormData(formData, index);
    const finalPrompt = normalizePromptText(data.final_prompt) || promptText;

    prependHistoryItem({
      video_url: data.video_url,
      duration: data.duration,
      resolution: data.resolution,
      aspect_ratio: data.aspect_ratio,
      prompt_index: index + 1,
      prompt: promptText,
      final_prompt: finalPrompt,
      created_at: new Date().toISOString()
    });
    if (!Array.isArray(state.sceneVideos)) state.sceneVideos = [];
    state.sceneVideos[index] = {
      video_url: data.video_url,
      duration: data.duration,
      resolution: data.resolution,
      aspect_ratio: data.aspect_ratio,
      prompt_index: index + 1,
      prompt: promptText,
      final_prompt: finalPrompt,
      created_at: new Date().toISOString()
    };
    state.videoStatuses[index] = "done";
    setHistoryExpanded(true);
    setStatus(`Video #${index + 1} generated.`);
  } catch (error) {
    state.videoStatuses[index] = "error";
    throw error;
  } finally {
    renderFirstFrames();
  }
}

async function generatePromptsSequential() {
  if (!state.imageFile) throw new Error("Reference image is required.");
  const count = getVideoCount();
  state.preparedPrompts = [];
  state.scenePlans = [];
  state.firstFrames = [];
  state.firstFrameStatuses = [];
  state.firstFrameTasks = [];
  state.videoStatuses = [];
  state.sceneVideos = [];
  renderPromptPlan();
  renderFirstFrames();

  setStatus("Generating different scene directions and final prompts...");
  const reqData = new FormData();
  reqData.append("openai_api_key", state.openaiApiKey);
  reqData.append("image", state.imageFile, state.imageFile.name);
  reqData.append("count", String(count));
  reqData.append("duration", durationSelect.value);

  const res = await fetch("/api/auto-prompt", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();
  if (!res.ok) {
    if (data?.direction_debug) logDirectionDebug(data.direction_debug, data.error || "Failed to generate prompts.");
    if (Array.isArray(data?.prompt_debug)) {
      data.prompt_debug.forEach((entry) => {
        addModelDebugEvent({
          provider: "openai",
          operation: `chat/completions (prompt #${entry.index || "?"})`,
          request: entry.request || null,
          response: { ...(entry.response || {}), raw: entry.raw || null },
          error: data.error || "Failed to generate prompts."
        });
      });
    }
    throw new Error(data.error || "Failed to generate prompts.");
  }

  if (data?.direction_debug) logDirectionDebug(data.direction_debug);
  if (Array.isArray(data?.prompt_debug)) {
    data.prompt_debug.forEach((entry) => {
      addModelDebugEvent({
        provider: "openai",
        operation: `chat/completions (prompt #${entry.index || "?"})`,
        request: entry.request || null,
        response: {
          ...(entry.response || {}),
          raw: entry.raw || null,
          extracted_prompt_preview: entry.extracted_prompt_preview || null
        }
      });
    });
  }

  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  const directions = Array.isArray(data.directions) ? data.directions : [];

  if (scenes.length < count && directions.length < count) {
    throw new Error("Scene direction generation returned insufficient results.");
  }

  const plans = new Array(count).fill(null).map((_, idx) => {
    const scene = scenes[idx] || { direction: directions[idx] || "" };
    const plan = normalizeScenePlanEntry(scene, "");
    if (!plan.direction) plan.direction = `Scene #${idx + 1}`;
    return plan;
  });

  state.scenePlans = plans;
  state.preparedPrompts = plans.map(() => "");
  state.firstFrameStatuses = plans.map(() => "idle");
  state.firstFrameTasks = plans.map(() => null);
  state.videoStatuses = plans.map(() => "idle");
  state.sceneVideos = plans.map(() => null);
  renderPromptPlan();
}

tabStep1.addEventListener("click", () => switchStep(1));
tabStep2.addEventListener("click", () => {
  if (!state.openaiApiKey || !state.xaiApiKey) {
    setStatus("Complete Step 1 first.", "error");
    return;
  }
  switchStep(2);
});
tabStep3.addEventListener("click", () => {
  if (!state.openaiApiKey || !state.xaiApiKey) {
    setStatus("Complete Step 1 first.", "error");
    return;
  }
  renderSnapshot();
  renderPromptPlan();
  renderFirstFrames();
  renderModelDebug();
  renderHistory();
  switchStep(3);
});

toStep2Btn.addEventListener("click", () => {
  const openaiKey = String(openaiApiKeyInput.value || "").trim();
  const xaiKey = String(xaiApiKeyInput.value || "").trim();
  if (!openaiKey || !xaiKey) {
    setStatus("Both API keys are required.", "error");
    return;
  }
  state.openaiApiKey = openaiKey;
  state.xaiApiKey = xaiKey;
  clearStatus();
  switchStep(2);
});

imageInput.addEventListener("change", () => {
  state.imageFile = imageInput.files?.[0] || null;
  state.preparedPrompts = [];
  state.scenePlans = [];
  state.firstFrames = [];
  state.firstFrameStatuses = [];
  state.firstFrameTasks = [];
  state.videoStatuses = [];
  state.sceneVideos = [];
  clearModelDebug();
  renderPromptPlan();
  renderFirstFrames();
  updateReferencePreview(state.imageFile);
  renderSnapshot();
});

[videoCountInput, durationSelect, resolutionSelect, aspectRatioSelect].forEach((el) => {
  el.addEventListener("change", () => {
    state.preparedPrompts = [];
    state.scenePlans = [];
    state.firstFrames = [];
    state.firstFrameStatuses = [];
    state.firstFrameTasks = [];
    state.videoStatuses = [];
    state.sceneVideos = [];
    renderPromptPlan();
    renderFirstFrames();
    renderSnapshot();
  });
});

if (clearDebugBtn) {
  clearDebugBtn.addEventListener("click", () => {
    clearModelDebug();
    setStatus("Debug log cleared.");
  });
}

generatePromptsBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    clearModelDebug();
    await generatePromptsSequential();
    renderSnapshot();
    switchStep(3);
    await generateFirstFrames(false);
    setStatus(`Generated ${state.preparedPrompts.length} scene directions and first frames.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(false);
  }
});

if (toggleHistoryBtn) {
  toggleHistoryBtn.addEventListener("click", () => {
    setHistoryExpanded(!state.historyExpanded);
  });
}

if (closeImageZoomBtn) {
  closeImageZoomBtn.addEventListener("click", () => closeImageZoom());
}

if (imageZoomModal) {
  imageZoomModal.addEventListener("click", (event) => {
    if (event.target === imageZoomModal) closeImageZoom();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImageZoom();
    return;
  }
  if (event.metaKey && String(event.key || "").toLowerCase() === "j") {
    event.preventDefault();
    state.advancedPanelsVisible = !state.advancedPanelsVisible;
    applyAdvancedPanelsVisibility();
    renderFirstFrames();
    setStatus(state.advancedPanelsVisible ? "Advanced panels shown." : "Advanced panels hidden.");
  }
});

renderPromptPlan();
renderFirstFrames();
renderHistory();
renderModelDebug();
renderSnapshot();
applyAdvancedPanelsVisibility();
setHistoryExpanded(false);
switchStep(1);
