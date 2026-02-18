const generateForm = document.getElementById("generateForm");
const statusBox = document.getElementById("statusBox");
const historyList = document.getElementById("historyList");
const imageInput = document.getElementById("imageInput");
const generatePromptsBtn = document.getElementById("generatePromptsBtn");
const generateVideoBtn = document.getElementById("generateVideoBtn");
const promptPlanList = document.getElementById("promptPlanList");
const videoCountInput = generateForm.querySelector("input[name='video_count']");

const HISTORY_KEY = "humanize_grok_video_history";
let preparedPrompts = [];

function normalizePromptText(input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (text === "[object Object]") return "";
    return text;
  }
  if (input == null) return "";
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) {
    return input
      .map((item) => normalizePromptText(item))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof input === "object") {
    if (typeof input.prompt === "string") return input.prompt.trim();
    if (typeof input.text === "string") return input.text.trim();
    if (typeof input.content === "string") return input.content.trim();
    try {
      return JSON.stringify(input, null, 2).trim();
    } catch {
      return "";
    }
  }
  return "";
}

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden", "error");
  if (type === "error") statusBox.classList.add("error");
}

function setBusy(form, busy) {
  if (generatePromptsBtn) {
    generatePromptsBtn.disabled = busy;
  }
  if (generateVideoBtn) {
    generateVideoBtn.disabled = busy;
    generateVideoBtn.textContent = busy ? "Generating..." : "Generate Video";
  }
}

function getRequestedVideoCount() {
  const countRaw = String(new FormData(generateForm).get("video_count") || "").trim();
  const value = Number.parseInt(countRaw, 10);
  if (!Number.isInteger(value)) return 3;
  return Math.max(1, Math.min(8, value));
}

function renderPromptPlan(prompts) {
  const list = Array.isArray(prompts) ? prompts : [];
  promptPlanList.innerHTML = "";

  if (!list.length) {
    promptPlanList.innerHTML = '<p class="muted">No prompts generated yet.</p>';
    return;
  }

  list.forEach((prompt, idx) => {
    const block = document.createElement("article");
    block.className = "prompt-plan-item";

    const title = document.createElement("p");
    title.className = "muted";
    title.textContent = `Prompt #${idx + 1}`;

    const content = document.createElement("pre");
    content.className = "prompt-preview";
    content.textContent = normalizePromptText(prompt);

    block.append(title, content);
    promptPlanList.appendChild(block);
  });
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

function renderHistory() {
  const history = getHistory();
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
    promptTitle.textContent = `Prompt${item.prompt_index ? ` #${item.prompt_index}` : ""}:`;

    const promptPreview = document.createElement("pre");
    promptPreview.className = "prompt-preview";
    promptPreview.textContent = normalizePromptText(item.prompt) || "(no prompt recorded)";

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
    downloadLinkEl.href = item.video_url;
    downloadLinkEl.download = "generated-video.mp4";
    downloadLinkEl.textContent = "Download";

    actions.append(openLink, downloadLinkEl);
    card.append(title, meta, promptTitle, promptPreview, video, actions);
    historyList.appendChild(card);
  });
}

function prependHistoryItem(item) {
  const history = getHistory();
  history.unshift(item);
  saveHistory(history.slice(0, 30));
  renderHistory();
}

async function createVideoWithFormData(formData) {
  const createRes = await fetch("/api/generate-video", {
    method: "POST",
    body: formData
  });
  const createData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(createData.error || "Failed to create task");
  }
  if (!createData.video_url) {
    throw new Error("No video URL returned by xai_sdk call");
  }
  return createData;
}

async function autoGenerateVideos(prompts) {
  const promptList = Array.isArray(prompts)
    ? prompts.map((p) => normalizePromptText(p)).filter(Boolean)
    : [];
  if (!promptList.length) throw new Error("No prompts available for auto-generation.");

  for (let i = 0; i < promptList.length; i += 1) {
    const formData = new FormData(generateForm);
    formData.set("prompt", promptList[i]);

    setStatus(`Auto-generating video ${i + 1}/${promptList.length}...`);
    const createData = await createVideoWithFormData(formData);

    prependHistoryItem({
      video_url: createData.video_url,
      duration: createData.duration,
      resolution: createData.resolution,
      aspect_ratio: createData.aspect_ratio,
      prompt_index: i + 1,
      prompt: promptList[i],
      created_at: new Date().toISOString()
    });

    if (i < promptList.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function generateAutoPromptAtIndex(promptIndex, totalCount) {
  const formData = new FormData(generateForm);
  const openaiApiKey = String(formData.get("openai_api_key") || "").trim();
  const image = imageInput.files?.[0];
  const duration = String(formData.get("duration") || "4").trim();

  if (!openaiApiKey) {
    throw new Error("OpenAI API key is required.");
  }
  if (!image) throw new Error("Please upload an image first.");

  const reqData = new FormData();
  reqData.append("openai_api_key", openaiApiKey);
  reqData.append("image", image);
  reqData.append("count", String(totalCount));
  reqData.append("duration", duration);

  const res = await fetch("/api/auto-prompt", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Failed to auto-generate prompt.");
  }

  const prompt = normalizePromptText(data.prompt);
  if (!prompt) {
    throw new Error("Auto-prompt API returned no prompts.");
  }
  return prompt;
}

async function generateAutoPromptsSequential() {
  const count = getRequestedVideoCount();
  const prompts = [];
  for (let i = 1; i <= count; i += 1) {
    setStatus(`Generating prompt ${i}/${count}...`);
    const prompt = await generateAutoPromptAtIndex(i, count);
    prompts.push(prompt);
    preparedPrompts = [...prompts];
    renderPromptPlan(preparedPrompts);
  }

  setStatus(`Generated ${prompts.length} prompts from image.`);
  return prompts;
}

imageInput.addEventListener("change", () => {
  preparedPrompts = [];
  renderPromptPlan([]);
  setStatus("Image selected. Click 'Generate Prompts' first, then click 'Generate Video'.");
});

videoCountInput.addEventListener("change", () => {
  preparedPrompts = [];
  renderPromptPlan([]);
  setStatus("Video count changed. Regenerate prompts before batch generation.");
});

generateForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

generatePromptsBtn.addEventListener("click", async () => {
  try {
    setBusy(generateForm, true);
    preparedPrompts = [];
    renderPromptPlan([]);
    setStatus("Generating prompts from image...");
    await generateAutoPromptsSequential();
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(generateForm, false);
  }
});

generateVideoBtn.addEventListener("click", async () => {
  setBusy(generateForm, true);

  try {
    const count = getRequestedVideoCount();

    let promptBatch = preparedPrompts.slice(0, count).map((p) => normalizePromptText(p)).filter(Boolean);
    if (!promptBatch.length && imageInput.files?.length) {
      setStatus("No prepared prompts found. Generating prompts first...");
      promptBatch = await generateAutoPromptsSequential();
    }
    if (!promptBatch.length) {
      throw new Error("No prompts found. Please upload an image and click 'Generate Prompts' first.");
    }

    if (promptBatch.length < count) {
      while (promptBatch.length < count) {
        promptBatch.push(promptBatch[promptBatch.length - 1]);
      }
    }

    setStatus(`Submitting ${count} video generation request(s)...`);

    await autoGenerateVideos(promptBatch.slice(0, count));
    setStatus(`Done. Generated ${count} videos.`);
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(generateForm, false);
  }
});

renderPromptPlan([]);
renderHistory();
