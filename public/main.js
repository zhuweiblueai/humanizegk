const generateForm = document.getElementById("generateForm");
const statusBox = document.getElementById("statusBox");
const resultBox = document.getElementById("resultBox");
const videoPlayer = document.getElementById("videoPlayer");
const downloadLink = document.getElementById("downloadLink");
const requestPreviewBox = document.getElementById("requestPreviewBox");
const requestPreviewContent = document.getElementById("requestPreviewContent");

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.classList.remove("hidden", "error");
  if (type === "error") statusBox.classList.add("error");
}

function setBusy(form, busy) {
  const button = form.querySelector("button[type='submit']");
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? "Generating..." : "Generate Video";
}

function showResult(url) {
  videoPlayer.src = url;
  downloadLink.href = url;
  downloadLink.textContent = url;
  resultBox.classList.remove("hidden");
}

function showRequestPreview(payload) {
  if (!payload) return;
  requestPreviewContent.textContent = JSON.stringify(payload, null, 2);
  requestPreviewBox.classList.remove("hidden");
}

generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(generateForm, true);

  try {
    const formData = new FormData(generateForm);

    setStatus("Submitting video generation request...");

    const createRes = await fetch("/api/generate-video", {
      method: "POST",
      body: formData
    });
    const createData = await createRes.json();

    if (!createRes.ok) {
      throw new Error(createData.error || "Failed to create task");
    }

    showRequestPreview(createData.request_preview);

    if (!createData.video_url) {
      throw new Error("No video URL returned by xai_sdk call");
    }

    setStatus(
      `Video generated (${createData.duration}s / ${createData.resolution} / aspect: ${createData.aspect_ratio} / reference: ${createData.has_reference_image ? `uploaded ${createData.uploaded_image_mime || ""} ${createData.uploaded_image_bytes || 0}B` : "not uploaded"}${createData.image_preprocess?.padded ? ` / padded to ${createData.image_preprocess.target_width}x${createData.image_preprocess.target_height}` : ""}).`
    );

    showResult(createData.video_url);
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  } finally {
    setBusy(generateForm, false);
  }
});
