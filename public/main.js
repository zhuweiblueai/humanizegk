const generateForm = document.getElementById("generateForm");
const statusBox = document.getElementById("statusBox");
const resultBox = document.getElementById("resultBox");
const videoPlayer = document.getElementById("videoPlayer");
const downloadLink = document.getElementById("downloadLink");
const historyList = document.getElementById("historyList");
const imageInput = document.getElementById("imageInput");

const HISTORY_KEY = "humanize_grok_video_history";

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden", "error");
  if (type === "error") statusBox.classList.add("error");
}

function setBusy(form, busy) {
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = busy;
    submitButton.textContent = busy ? "Generating..." : "Generate Video";
  }
}

function showResult(url) {
  videoPlayer.src = url;
  downloadLink.href = url;
  downloadLink.textContent = url;
  resultBox.classList.remove("hidden");
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
    card.append(title, meta, video, actions);
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

async function autoGenerateThreeVideos() {
  const promptField = generateForm.querySelector("textarea[name='prompt']");
  const basePrompt = String(promptField.value || "").trim();
  if (!basePrompt) throw new Error("Prompt is empty.");

  const variants = [
    "Version 1: hook-focused opening shot.",
    "Version 2: close-up detail showcase shot.",
    "Version 3: CTA-focused conversion ending shot."
  ];

  for (let i = 0; i < variants.length; i += 1) {
    const formData = new FormData(generateForm);
    formData.set("prompt", `${basePrompt}\n${variants[i]}`);

    setStatus(`Auto-generating video ${i + 1}/3...`);
    const createData = await createVideoWithFormData(formData);

    showResult(createData.video_url);
    prependHistoryItem({
      video_url: createData.video_url,
      duration: createData.duration,
      resolution: createData.resolution,
      aspect_ratio: createData.aspect_ratio,
      created_at: new Date().toISOString()
    });
  }
}

async function generateAutoPrompt() {
  const formData = new FormData(generateForm);
  const apiKey = String(formData.get("api_key") || "").trim();
  const image = imageInput.files?.[0];

  if (!apiKey) {
    throw new Error("API key is required.");
  }
  if (!image) throw new Error("Please upload an image first.");

  const reqData = new FormData();
  reqData.append("api_key", apiKey);
  reqData.append("image", image);

  const res = await fetch("/api/auto-prompt", {
    method: "POST",
    body: reqData
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "Failed to auto-generate prompt.");
  }

  const promptField = generateForm.querySelector("textarea[name='prompt']");
  promptField.value = data.prompt;
  setStatus("Prompt generated from image and filled into the input.");
}

imageInput.addEventListener("change", async () => {
  if (!imageInput.files?.length) return;
  try {
    setBusy(generateForm, true);
    setStatus("Generating TikTok product-selling prompt from image...");
    await generateAutoPrompt();
    await autoGenerateThreeVideos();
    setStatus("Done. 3 videos generated automatically.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(generateForm, false);
  }
});

generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(generateForm, true);

  try {
    const formData = new FormData(generateForm);

    setStatus("Submitting video generation request...");

    const createData = await createVideoWithFormData(formData);

    setStatus(
      `Video generated (${createData.duration}s / ${createData.resolution} / aspect: ${createData.aspect_ratio} / reference: ${createData.has_reference_image ? `uploaded ${createData.uploaded_image_mime || ""} ${createData.uploaded_image_bytes || 0}B` : "not uploaded"}${createData.image_preprocess?.padded ? ` / padded to ${createData.image_preprocess.target_width}x${createData.image_preprocess.target_height}` : ""}).`
    );

    showResult(createData.video_url);
    prependHistoryItem({
      video_url: createData.video_url,
      duration: createData.duration,
      resolution: createData.resolution,
      aspect_ratio: createData.aspect_ratio,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(generateForm, false);
  }
});

renderHistory();
