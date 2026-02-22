const statusBox = document.getElementById("statusBox");
const historyList = document.getElementById("historyList");
const openHistoryModalBtn = document.getElementById("openHistoryModalBtn");
const firstFrameList = document.getElementById("firstFrameList");
const modelDebugBox = document.getElementById("modelDebugBox");
const modelDebugSection = document.getElementById("modelDebugSection");

const step2Panel = document.getElementById("step2Panel");
const step3Panel = document.getElementById("step3Panel");

const tabStep2 = document.getElementById("tabStep2");
const tabStep3 = document.getElementById("tabStep3");

const imageInput = document.getElementById("imageInput");
const videoCountInput = document.getElementById("videoCountInput");
const targetMarketInput = document.getElementById("targetMarketInput");
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
const analysisOverlay = document.getElementById("analysisOverlay");
const analysisOverlayImage = document.getElementById("analysisOverlayImage");
const openAuthModalBtn = document.getElementById("openAuthModalBtn");
const accountMenu = document.getElementById("accountMenu");
const accountMenuBtn = document.getElementById("accountMenuBtn");
const openAdminModalBtn = document.getElementById("openAdminModalBtn");
const adminConsoleModal = document.getElementById("adminConsoleModal");
const closeAdminModalBtn = document.getElementById("closeAdminModalBtn");
const historyModal = document.getElementById("historyModal");
const closeHistoryModalBtn = document.getElementById("closeHistoryModalBtn");
const authModal = document.getElementById("authModal");
const closeAuthModalBtn = document.getElementById("closeAuthModalBtn");
const authGuestSection = document.getElementById("authGuestSection");
const authEmailInput = document.getElementById("authEmailInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authRegisterBtn = document.getElementById("authRegisterBtn");
const authLoginBtn = document.getElementById("authLoginBtn");
const authLogoutBtn = document.getElementById("authLogoutBtn");
const authRefreshBtn = document.getElementById("authRefreshBtn");
const authUserInfo = document.getElementById("authUserInfo");
const authBalanceInfo = document.getElementById("authBalanceInfo");
const openAccountUsageBtn = document.getElementById("openAccountUsageBtn");
const accountUsageModal = document.getElementById("accountUsageModal");
const closeAccountUsageModalBtn = document.getElementById("closeAccountUsageModalBtn");
const accountUsageSummaryModalBox = document.getElementById("accountUsageSummaryModalBox");
const googleLoginBtn = document.getElementById("googleLoginBtn");
const adminPanel = document.getElementById("adminPanel");
const adminRefreshBtn = document.getElementById("adminRefreshBtn");
const grantUserSelect = document.getElementById("grantUserSelect");
const grantAmountInput = document.getElementById("grantAmountInput");
const grantReasonInput = document.getElementById("grantReasonInput");
const grantCreditsBtn = document.getElementById("grantCreditsBtn");
const adminSummaryText = document.getElementById("adminSummaryText");
const adminPricingTableBody = document.getElementById("adminPricingTableBody");
const adminPricingAlertsBox = document.getElementById("adminPricingAlertsBox");
const adminAccountsTableBody = document.getElementById("adminAccountsTableBody");
const adminVideoUserFilter = document.getElementById("adminVideoUserFilter");
const adminVideosTable = document.getElementById("adminVideosTable");
const adminVideosTableBody = document.getElementById("adminVideosTableBody");
const adminVideoDetailBox = document.getElementById("adminVideoDetailBox");

const HISTORY_KEY = "humanize_grok_video_history";

const state = {
  step: 1,
  busy: false,
  imageFile: null,
  targetMarket: "Malaysia",
  preparedPrompts: [],
  scenePlans: [],
  firstFrames: [],
  firstFrameStatuses: [],
  firstFrameTasks: [],
  videoStatuses: [],
  videoErrors: [],
  sceneVideos: [],
  historyModalOpen: false,
  modelDebugEvents: [],
  advancedPanelsVisible: false,
  analysisOverlayImageUrl: "",
  resumeGenerateAfterAuth: false,
  authUser: null,
  authBalance: "0.0000",
  hasPlatformOpenAiKey: false,
  hasPlatformXaiKey: false,
  googleOAuthEnabled: false,
  accountUsageLoading: false,
  accountSummary: null,
  adminUsers: [],
  adminAccountsOverview: [],
  adminAccountsTotals: null,
  adminDefaultPricing: [],
  adminPricingAlerts: [],
  adminVideoEvents: [],
  adminSelectedVideoDetail: null,
  adminVideoFilterUserId: ""
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

async function readApiResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const compact = String(text).replace(/\s+/g, " ").trim();
    const preview = compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
    return {
      error: `Non-JSON response (${response.status}). ${preview || "Empty response body."}`
    };
  }
}

function setBusy(busy) {
  state.busy = busy;
  generatePromptsBtn.disabled = busy;
  if (openHistoryModalBtn) openHistoryModalBtn.disabled = busy;
  if (clearDebugBtn) clearDebugBtn.disabled = busy;
  generatePromptsBtn.textContent = busy ? "Processing..." : "Generate Prompts";
}

function hasAuth() {
  return Boolean(state.authUser?.id);
}

function formatUsd(value, digits = 6) {
  const number = Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(number)) return (0).toFixed(digits);
  return number.toFixed(digits);
}

function renderAccountUsageModalContent() {
  if (!accountUsageSummaryModalBox) return;
  if (state.accountUsageLoading) {
    accountUsageSummaryModalBox.textContent = "Loading account spending details...";
    return;
  }

  const payload = state.accountSummary || null;
  const summary = payload?.summary || null;
  const recentUsage = Array.isArray(payload?.recent_usage) ? payload.recent_usage : [];
  if (!summary) {
    accountUsageSummaryModalBox.textContent = "No spending details yet.";
    return;
  }

  const lines = [
    `Balance USD: ${formatUsd(summary.balance_usd, 4)}`,
    `Granted USD: ${formatUsd(summary.granted_usd, 4)}`,
    `Recharged USD: ${formatUsd(summary.recharged_usd, 4)}`,
    `Used USD (billed): ${formatUsd(summary.used_usd, 6)}`,
    `OpenAI Billed USD: ${formatUsd(summary.openai_cost_usd, 6)}`,
    `xAI Billed USD: ${formatUsd(summary.xai_cost_usd, 6)}`,
    `Usage Events: ${summary.usage_event_count ?? recentUsage.length ?? 0}`,
    "",
    "Recent Usage:"
  ];

  if (!recentUsage.length) {
    lines.push("- none");
  } else {
    recentUsage.slice(0, 12).forEach((item) => {
      const timeText = item?.created_at ? new Date(item.created_at).toLocaleString() : "-";
      const provider = String(item?.provider || "-");
      const operation = String(item?.operation || "-");
      const billedUsd = formatUsd(item?.billed_usd, 6);
      lines.push(`- ${timeText} | ${provider} | ${operation} | billed ${billedUsd}`);
    });
  }

  accountUsageSummaryModalBox.textContent = lines.join("\n");
}

function openAccountUsageModal() {
  if (!accountUsageModal) return;
  accountUsageModal.classList.remove("hidden");
  renderAccountUsageModalContent();
}

function closeAccountUsageModal() {
  if (!accountUsageModal) return;
  accountUsageModal.classList.add("hidden");
}

async function refreshAccountUsageSummary({ showStatus = false } = {}) {
  if (!hasAuth()) {
    state.accountSummary = null;
    state.accountUsageLoading = false;
    renderAccountUsageModalContent();
    return;
  }
  state.accountUsageLoading = true;
  renderAccountUsageModalContent();
  const res = await fetch("/api/account/summary");
  const data = await readApiResponse(res);
  if (!res.ok) {
    state.accountUsageLoading = false;
    renderAccountUsageModalContent();
    throw new Error(data.error || "Failed to load account spending details.");
  }
  state.accountSummary = data || null;
  state.accountUsageLoading = false;
  renderAccountUsageModalContent();
  if (showStatus) setStatus("Account spending details loaded.");
}

function renderAuthUI() {
  const authed = hasAuth();
  if (openAuthModalBtn) openAuthModalBtn.classList.toggle("hidden", authed);
  if (accountMenu) accountMenu.classList.toggle("hidden", !authed);
  if (accountMenuBtn) accountMenuBtn.textContent = authed ? state.authUser.email : "Account";
  if (authGuestSection) authGuestSection.classList.toggle("hidden", authed);
  if (authUserInfo) {
    const user = state.authUser;
    authUserInfo.textContent = user
      ? `${user.email} | role=${user.role} | verified=${user.email_verified ? "yes" : "no"}`
      : "";
  }
  if (authBalanceInfo) authBalanceInfo.textContent = `${state.authBalance} USD`;
  if (googleLoginBtn) googleLoginBtn.classList.toggle("hidden", !state.googleOAuthEnabled);
  const isAdmin = state.authUser?.role === "ADMIN";
  if (openAdminModalBtn) openAdminModalBtn.classList.toggle("hidden", !isAdmin);
  if (adminPanel) adminPanel.classList.toggle("hidden", !isAdmin);
  if (!isAdmin) {
    state.adminUsers = [];
    state.adminAccountsOverview = [];
    state.adminAccountsTotals = null;
    state.adminDefaultPricing = [];
    state.adminPricingAlerts = [];
    state.adminVideoEvents = [];
    state.adminSelectedVideoDetail = null;
    state.adminVideoFilterUserId = "";
    closeAdminModal();
  }
  if (!authed) {
    state.accountUsageLoading = false;
    state.accountSummary = null;
    closeAccountUsageModal();
  }
  if (openAccountUsageBtn) openAccountUsageBtn.textContent = "View Spending Details";
  renderAccountUsageModalContent();
  renderAdminPanel();
}

async function refreshAuthState(showStatus = false) {
  const res = await fetch("/api/auth/me");
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(data.error || "Failed to load auth state.");
  state.authUser = data?.authenticated ? data.user : null;
  state.authBalance = String(data?.balance_usd ?? data?.balance_credits ?? "0.0000");
  state.hasPlatformOpenAiKey = Boolean(data?.platform_api_keys?.openai);
  state.hasPlatformXaiKey = Boolean(data?.platform_api_keys?.xai);
  state.googleOAuthEnabled = Boolean(data?.google_oauth_enabled);
  renderAuthUI();
  if (showStatus) {
    if (!state.authUser) setStatus("Signed out.");
  }
  if (state.authUser?.role === "ADMIN") {
    try {
      await refreshAdminData();
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  }
}

function renderAdminPanel() {
  if (!adminPanel) return;
  const isAdmin = state.authUser?.role === "ADMIN";
  if (!isAdmin) return;

  if (adminSummaryText) {
    const totals = state.adminAccountsTotals || {};
    const users = Array.isArray(state.adminAccountsOverview) ? state.adminAccountsOverview.length : 0;
    adminSummaryText.textContent = [
      `Accounts: ${users}`,
      `Granted: ${totals.granted_usd || "0.0000"} USD`,
      `Recharged: ${totals.recharged_usd || "0.0000"} USD`,
      `Consumed (Billed): ${totals.used_usd || "0.000000"} USD`,
      `Provider Cost Est.: ${totals.platform_cost_estimated_usd || "0.000000"} USD`,
      `OpenAI Cost Est.: ${totals.openai_platform_cost_estimated_usd || "0.000000"} USD`,
      `xAI Cost Est.: ${totals.xai_platform_cost_estimated_usd || "0.000000"} USD`,
      `Remaining: ${totals.remaining_usd || "0.0000"} USD`
    ].join(" | ");
  }

  if (grantUserSelect) {
    const current = grantUserSelect.value;
    grantUserSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select user";
    grantUserSelect.appendChild(placeholder);
    (state.adminUsers || []).forEach((user) => {
      const opt = document.createElement("option");
      opt.value = user.id;
      const balanceUsd = String(user.balance_usd ?? user.balance_credits ?? "0.0000");
      const title = user.email || user.username || user.id;
      opt.textContent = `${title} | ${balanceUsd} USD`;
      grantUserSelect.appendChild(opt);
    });
    if (current) grantUserSelect.value = current;
  }

  if (adminPricingTableBody) {
    adminPricingTableBody.innerHTML = "";
    const rows = (state.adminDefaultPricing || []).slice();
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="9" class="muted">No default pricing rows.</td>';
      adminPricingTableBody.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(row.provider || "")}</td>
          <td>${escapeHtml(row.operation || "")}</td>
          <td>${escapeHtml(row.model || "-")}</td>
          <td>${escapeHtml(row.unit_type || "")}</td>
          <td>${escapeHtml(row.cost_price_usd_per_unit || "0")}</td>
          <td>${escapeHtml(row.default_price_usd_per_unit || "0")}</td>
          <td>${escapeHtml(row.markup_multiplier || "-")}</td>
          <td>${escapeHtml(row.gross_margin_usd_per_unit || "0")}</td>
          <td>${escapeHtml(row.note || "")}</td>
        `;
        adminPricingTableBody.appendChild(tr);
      });
    }
  }

  if (adminPricingAlertsBox) {
    const alerts = Array.isArray(state.adminPricingAlerts) ? state.adminPricingAlerts : [];
    if (!alerts.length) {
      adminPricingAlertsBox.textContent = "No pricing review alerts.";
    } else {
      adminPricingAlertsBox.textContent = alerts
        .map((item) => {
          const modelText = item?.model ? ` | model=${item.model}` : "";
          return `[${item.provider}] ${item.operation}${modelText} | count=${item.events} | ${item.message}`;
        })
        .join("\n");
    }
  }

  if (adminAccountsTableBody) {
    adminAccountsTableBody.innerHTML = "";
    const rows = (state.adminAccountsOverview || []).slice();
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="12" class="muted">No account data.</td>';
      adminAccountsTableBody.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(row.email || "")}</td>
          <td>${escapeHtml(row.role || "")}</td>
          <td>${escapeHtml(row.granted_usd || "0")}</td>
          <td>${escapeHtml(row.recharged_usd || "0")}</td>
          <td>${escapeHtml(row.used_usd || "0")}</td>
          <td>${escapeHtml(row.platform_cost_estimated_usd || "0")}</td>
          <td>${escapeHtml(row.remaining_usd || "0")}</td>
          <td>${escapeHtml(row.openai_cost_usd || "0")}</td>
          <td>${escapeHtml(row.xai_cost_usd || "0")}</td>
          <td>${escapeHtml(row.openai_platform_cost_estimated_usd || "0")}</td>
          <td>${escapeHtml(row.xai_platform_cost_estimated_usd || "0")}</td>
          <td>${escapeHtml(String(row.video_events || 0))}</td>
        `;
        adminAccountsTableBody.appendChild(tr);
      });
    }
  }

  if (adminVideoUserFilter) {
    const current = state.adminVideoFilterUserId || "";
    adminVideoUserFilter.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All accounts";
    adminVideoUserFilter.appendChild(allOption);
    (state.adminUsers || []).forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.email || user.username || user.id;
      adminVideoUserFilter.appendChild(option);
    });
    adminVideoUserFilter.value = current;
  }

  if (adminVideosTableBody) {
    adminVideosTableBody.innerHTML = "";
    const filterUserId = String(state.adminVideoFilterUserId || "").trim();
    const rows = (state.adminVideoEvents || []).filter((row) => !filterUserId || row.user_id === filterUserId);
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="7" class="muted">No video generation records.</td>';
      adminVideosTableBody.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const createdAtText = row.created_at ? new Date(row.created_at).toLocaleString() : "-";
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(createdAtText)}</td>
          <td>${escapeHtml(row.user_email || row.user_id || "")}</td>
          <td>${escapeHtml(row.model || "")}</td>
          <td>${escapeHtml(row.resolution || "-")}</td>
          <td>${escapeHtml(`${row.duration_seconds || "-"}s`)}</td>
          <td>${escapeHtml(row.cost_usd || "0")}</td>
          <td><button class="secondary-btn details-btn" type="button" data-video-detail-id="${escapeHtml(row.usage_event_id || "")}">View</button></td>
        `;
        adminVideosTableBody.appendChild(tr);
      });
    }
  }

  if (adminVideoDetailBox) {
    const detail = state.adminSelectedVideoDetail;
    if (!detail) {
      adminVideoDetailBox.innerHTML = '<p class="muted">Click one row in the list to view image/video detail.</p>';
    } else {
      const promptText = normalizePromptText(detail.final_prompt || "");
      const hasImage = Boolean(detail.input_image_data_uri);
      const hasVideo = Boolean(detail.video_url);
      adminVideoDetailBox.innerHTML = `
        <div class="admin-video-detail-grid">
          <div>
            ${hasImage ? `<img src="${escapeHtml(detail.input_image_data_uri)}" alt="video input frame" />` : '<p class="muted">Original uploaded input image was not stored for this event.</p>'}
          </div>
          <div>
            <p class="muted">Account: ${escapeHtml(detail.user_email || detail.user_id || "-")}</p>
            <p class="muted">Model: ${escapeHtml(detail.model || "-")} | Resolution: ${escapeHtml(detail.resolution || "-")} | Duration: ${escapeHtml(String(detail.duration_seconds || "-"))}s | Cost: ${escapeHtml(detail.cost_usd || "0")} USD</p>
            ${detail.linked_input_image_usage_event_id ? `<p class="muted">Input image event: ${escapeHtml(detail.linked_input_image_usage_event_id)}</p>` : ""}
            ${hasVideo ? `<a href="${escapeHtml(detail.video_url)}" target="_blank" rel="noopener noreferrer">Open video URL</a><video controls src="${escapeHtml(detail.video_url)}"></video>` : '<p class="muted">No video URL saved in this event.</p>'}
            <p class="muted">Prompt</p>
            <pre class="prompt-preview">${escapeHtml(promptText || "(empty)")}</pre>
          </div>
        </div>
      `;
    }
  }
}

async function refreshAdminData() {
  if (state.authUser?.role !== "ADMIN") return;
  const [usersRes, overviewRes, pricingRes, videosRes] = await Promise.all([
    fetch("/api/admin/users"),
    fetch("/api/admin/accounts-overview"),
    fetch("/api/admin/pricing"),
    fetch("/api/admin/videos?limit=300")
  ]);
  const [usersData, overviewData, pricingData, videosData] = await Promise.all([
    readApiResponse(usersRes),
    readApiResponse(overviewRes),
    readApiResponse(pricingRes),
    readApiResponse(videosRes)
  ]);
  if (!usersRes.ok) throw new Error(usersData.error || "Failed to load admin users.");
  if (!overviewRes.ok) throw new Error(overviewData.error || "Failed to load admin accounts overview.");
  if (!pricingRes.ok) throw new Error(pricingData.error || "Failed to load admin pricing.");
  if (!videosRes.ok) throw new Error(videosData.error || "Failed to load admin videos.");

  state.adminUsers = Array.isArray(usersData.users) ? usersData.users : [];
  state.adminAccountsOverview = Array.isArray(overviewData.accounts) ? overviewData.accounts : [];
  state.adminAccountsTotals = overviewData.totals || null;
  state.adminDefaultPricing = Array.isArray(pricingData.default_pricing) ? pricingData.default_pricing : [];
  state.adminPricingAlerts = Array.isArray(pricingData.pricing_review_alerts) ? pricingData.pricing_review_alerts : [];
  state.adminVideoEvents = Array.isArray(videosData.videos) ? videosData.videos : [];
  if (state.adminVideoFilterUserId) {
    const exists = state.adminUsers.some((user) => user.id === state.adminVideoFilterUserId);
    if (!exists) state.adminVideoFilterUserId = "";
  }
  if (state.adminSelectedVideoDetail?.usage_event_id) {
    const stillExists = state.adminVideoEvents.some((row) => row.usage_event_id === state.adminSelectedVideoDetail.usage_event_id);
    if (!stillExists) state.adminSelectedVideoDetail = null;
  }
  renderAdminPanel();
}

async function fetchAdminVideoDetail(usageEventId) {
  const id = String(usageEventId || "").trim();
  if (!id) return;
  const res = await fetch(`/api/admin/videos/${encodeURIComponent(id)}`);
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(data.error || "Failed to load video detail.");
  state.adminSelectedVideoDetail = data.video_detail || null;
  renderAdminPanel();
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

function normalizeTargetMarketValue(value) {
  const text = String(value || "").trim();
  return text || "Malaysia";
}

function getTargetMarket() {
  const market = normalizeTargetMarketValue(targetMarketInput?.value || state.targetMarket);
  state.targetMarket = market;
  return market;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  if (step2Panel) step2Panel.classList.toggle("hidden", targetStep !== 2);
  if (step3Panel) step3Panel.classList.toggle("hidden", targetStep !== 3);
  if (tabStep2) tabStep2.classList.toggle("active", targetStep === 2);
  if (tabStep3) tabStep3.classList.toggle("active", targetStep === 3);
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
  state.historyModalOpen = Boolean(expanded);
  if (historyModal) historyModal.classList.toggle("hidden", !state.historyModalOpen);
}

function closeHistoryModal() {
  setHistoryExpanded(false);
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
  if (openHistoryModalBtn) openHistoryModalBtn.textContent = `Generated Videos (${history.length})`;
  if (!historyList) return;
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
        await refreshAuthState().catch(() => {});
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
      const detail = normalizePromptText(state.videoErrors?.[i] || "");
      videoStep.textContent = detail ? `Video generation failed: ${detail}` : "Video generation failed.";
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
    videoTitle.classList.toggle("hidden", !latestVideo?.video_url);

    const videoWrap = document.createElement("div");
    videoWrap.classList.toggle("hidden", !latestVideo?.video_url);
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
  if (!summaryText) return;
  const imageName = state.imageFile?.name || "No image selected";
  const frameReadyCount = (state.firstFrames || []).filter((f) => typeof f?.dataUri === "string" && f.dataUri)
    .length;
  summaryText.textContent = [
    `Reference: ${imageName}`,
    `Market: ${getTargetMarket()}`,
    `First Frames: ${frameReadyCount}/${state.preparedPrompts.length || 0}`,
    `Video Count: ${getVideoCount()}`,
    `Duration: ${durationSelect.value}s`,
    `Resolution: ${resolutionSelect.value}`,
    `Aspect Ratio: ${aspectRatioSelect.value}`
  ].join(" | ");
}

function updateReferencePreview(file) {
  if (!referencePreview) return;
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

function parseAspectRatioValue(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) return null;
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

async function cropDataUriToAspectRatio(dataUri, aspectRatioValue) {
  const ratio = parseAspectRatioValue(aspectRatioValue);
  if (!ratio || !dataUri) return { dataUri, cropped: false };

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load frame image for crop."));
    img.src = dataUri;
  });

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return { dataUri, cropped: false };

  const sourceRatio = sourceWidth / sourceHeight;
  if (Math.abs(sourceRatio - ratio) <= 1e-4) {
    return { dataUri, cropped: false };
  }

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (sourceRatio > ratio) {
    cropWidth = Math.max(1, Math.floor(sourceHeight * ratio));
    offsetX = Math.floor((sourceWidth - cropWidth) / 2);
  } else {
    cropHeight = Math.max(1, Math.floor(sourceWidth / ratio));
    offsetY = Math.floor((sourceHeight - cropHeight) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = cropWidth;
  canvas.height = cropHeight;
  const context = canvas.getContext("2d");
  if (!context) return { dataUri, cropped: false };
  context.drawImage(
    image,
    offsetX,
    offsetY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight
  );

  return {
    dataUri: canvas.toDataURL("image/png"),
    cropped: true
  };
}

async function normalizeExistingFramesToAspectRatio() {
  const ratioText = String(aspectRatioSelect?.value || "").trim().toLowerCase();
  if (!ratioText || ratioText === "auto") return;
  if (!Array.isArray(state.firstFrames) || !state.firstFrames.length) return;

  let changed = false;
  for (let i = 0; i < state.firstFrames.length; i += 1) {
    const frame = state.firstFrames[i];
    if (!frame?.dataUri) continue;
    const cropResult = await cropDataUriToAspectRatio(frame.dataUri, ratioText);
    if (!cropResult?.cropped || !cropResult?.dataUri) continue;
    state.firstFrames[i] = {
      ...frame,
      dataUri: cropResult.dataUri,
      mime: "image/png",
      debug: {
        ...(frame.debug || {}),
        client_aspect_ratio_crop: {
          applied: true,
          target_aspect_ratio: ratioText
        }
      }
    };
    changed = true;
  }

  if (changed) {
    renderFirstFrames();
    renderSnapshot();
  }
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

function openAuthModal({ resumeGenerate = false } = {}) {
  state.resumeGenerateAfterAuth = Boolean(resumeGenerate);
  clearStatus();
  if (authModal) authModal.classList.remove("hidden");
}

function closeAuthModal({ clearResume = true } = {}) {
  if (clearResume) state.resumeGenerateAfterAuth = false;
  if (authModal) authModal.classList.add("hidden");
}

function openAdminModal() {
  if (!hasAuth() || state.authUser?.role !== "ADMIN") return;
  if (adminConsoleModal) adminConsoleModal.classList.remove("hidden");
}

function closeAdminModal() {
  if (adminConsoleModal) adminConsoleModal.classList.add("hidden");
}

function showAnalysisOverlay(file) {
  if (!analysisOverlay) return;
  if (state.analysisOverlayImageUrl) {
    URL.revokeObjectURL(state.analysisOverlayImageUrl);
    state.analysisOverlayImageUrl = "";
  }
  if (analysisOverlayImage) {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      state.analysisOverlayImageUrl = objectUrl;
      analysisOverlayImage.src = objectUrl;
      analysisOverlayImage.classList.remove("hidden");
    } else {
      analysisOverlayImage.src = "";
      analysisOverlayImage.classList.add("hidden");
    }
  }
  analysisOverlay.classList.remove("hidden");
}

function hideAnalysisOverlay() {
  if (!analysisOverlay) return;
  analysisOverlay.classList.add("hidden");
  if (analysisOverlayImage) {
    analysisOverlayImage.src = "";
    analysisOverlayImage.classList.add("hidden");
  }
  if (state.analysisOverlayImageUrl) {
    URL.revokeObjectURL(state.analysisOverlayImageUrl);
    state.analysisOverlayImageUrl = "";
  }
}

async function createVideoWithFormData(formData, index) {
  const res = await fetch("/api/generate-video", {
    method: "POST",
    body: formData
  });
  const data = await readApiResponse(res);
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
      estimated_debit_usd: data.estimated_debit_usd || null,
      estimated_cost_usd: data.estimated_cost_usd || null,
      estimated_debit_breakdown: data.estimated_debit_breakdown || null,
      billing_pricing_source: data.billing_pricing_source || null,
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
  formData.append("prompt", promptText);
  formData.append("target_market", getTargetMarket());
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
  const data = await readApiResponse(res);
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

  const cropResult = await cropDataUriToAspectRatio(frame.dataUri, aspectRatioSelect.value);
  if (cropResult?.dataUri) {
    frame.dataUri = cropResult.dataUri;
    frame.mime = "image/png";
    frame.debug = {
      ...(frame.debug || {}),
      client_aspect_ratio_crop: {
        applied: Boolean(cropResult.cropped),
        target_aspect_ratio: aspectRatioSelect.value
      }
    };
  }

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
  reqData.append("image", state.imageFile, state.imageFile.name);
  reqData.append("target_market", getTargetMarket());
  reqData.append("duration", durationSelect.value);
  reqData.append("index", String(index));
  reqData.append("total", String(total));
  reqData.append("existing_directions", JSON.stringify(existingDirections));

  const res = await fetch("/api/regenerate-scene", {
    method: "POST",
    body: reqData
  });
  const data = await readApiResponse(res);

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
  if (!Array.isArray(state.videoErrors)) state.videoErrors = [];
  state.videoErrors[index] = "";
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
  reqData.append("duration", durationSelect.value);
  reqData.append("target_market", getTargetMarket());
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
  const data = await readApiResponse(res);

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
    await refreshAuthState().catch(() => {});
    renderFirstFrames();
    renderSnapshot();
  }
}

async function generateVideoForIndex(index) {
  if (!state.preparedPrompts.length) {
    throw new Error("No generated scenes found. Please run Generate Prompts first.");
  }
  if (!Array.isArray(state.videoStatuses)) state.videoStatuses = [];
  if (!Array.isArray(state.videoErrors)) state.videoErrors = [];
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
  state.videoErrors[index] = "";
  renderFirstFrames();
  setStatus(`Video Step 1/2: Generating prompt for scene #${index + 1} from scene direction + frame...`);

  let promptText = "";
  try {
    promptText = await requestVideoPromptAtIndex(index);
  } catch (error) {
    state.videoStatuses[index] = "error";
    state.videoErrors[index] = normalizePromptText(error?.message || "Failed to generate scene video prompt.");
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
    state.videoErrors[index] = "";
    setStatus(`Video #${index + 1} generated.`);
  } catch (error) {
    state.videoStatuses[index] = "error";
    state.videoErrors[index] = normalizePromptText(error?.message || "Failed to generate video.");
    throw error;
  } finally {
    await refreshAuthState().catch(() => {});
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
  state.videoErrors = [];
  state.sceneVideos = [];
  renderPromptPlan();
  renderFirstFrames();

  setStatus("Generating different scene directions and final prompts...");
  const reqData = new FormData();
  reqData.append("image", state.imageFile, state.imageFile.name);
  reqData.append("target_market", getTargetMarket());
  reqData.append("count", String(count));
  reqData.append("duration", durationSelect.value);

  const res = await fetch("/api/auto-prompt", {
    method: "POST",
    body: reqData
  });
  const data = await readApiResponse(res);
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
  state.videoErrors = plans.map(() => "");
  state.sceneVideos = plans.map(() => null);
  renderPromptPlan();
}

async function runGeneratePromptsFlow() {
  if (!hasAuth()) {
    openAuthModal({ resumeGenerate: true });
    return;
  }
  if (!state.imageFile) throw new Error("Please upload a reference image first.");
  showAnalysisOverlay(state.imageFile);
  setBusy(true);
  clearModelDebug();
  try {
    await generatePromptsSequential();
    await generateFirstFrames(false);
    await normalizeExistingFramesToAspectRatio();
    await refreshAuthState().catch(() => {});
    renderSnapshot();
    switchStep(3);
    setStatus(`Generated ${state.preparedPrompts.length} scene directions and first frames.`);
  } finally {
    hideAnalysisOverlay();
    setBusy(false);
  }
}

async function maybeResumeGenerateAfterAuth() {
  if (!state.resumeGenerateAfterAuth) return;
  state.resumeGenerateAfterAuth = false;
  try {
    await runGeneratePromptsFlow();
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  }
}

if (tabStep2) {
  tabStep2.addEventListener("click", () => {
    switchStep(2);
  });
}

if (tabStep3) {
  tabStep3.addEventListener("click", () => {
    if (!hasAuth()) {
      openAuthModal();
      return;
    }
    renderSnapshot();
    renderPromptPlan();
    renderFirstFrames();
    renderModelDebug();
    renderHistory();
    void normalizeExistingFramesToAspectRatio();
    switchStep(3);
  });
}

imageInput.addEventListener("change", () => {
  state.targetMarket = getTargetMarket();
  state.imageFile = imageInput.files?.[0] || null;
  state.preparedPrompts = [];
  state.scenePlans = [];
  state.firstFrames = [];
  state.firstFrameStatuses = [];
  state.firstFrameTasks = [];
  state.videoStatuses = [];
  state.videoErrors = [];
  state.sceneVideos = [];
  clearModelDebug();
  renderPromptPlan();
  renderFirstFrames();
  updateReferencePreview(state.imageFile);
  renderSnapshot();
});

[videoCountInput, targetMarketInput, durationSelect, resolutionSelect, aspectRatioSelect].filter(Boolean).forEach((el) => {
  el.addEventListener("change", () => {
    state.targetMarket = getTargetMarket();
    state.preparedPrompts = [];
    state.scenePlans = [];
    state.firstFrames = [];
    state.firstFrameStatuses = [];
    state.firstFrameTasks = [];
    state.videoStatuses = [];
    state.videoErrors = [];
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
    await runGeneratePromptsFlow();
  } catch (error) {
    setStatus(`Error: ${error.message}`, "error");
  }
});

if (authRegisterBtn) {
  authRegisterBtn.addEventListener("click", async () => {
    try {
      const payload = {
        email: String(authEmailInput?.value || "").trim(),
        password: String(authPasswordInput?.value || "")
      };
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Register failed.");
      await refreshAuthState();
      closeAuthModal({ clearResume: false });
      const verifyText = data.verification_url
        ? `Registered. Verify email using this dev link: ${data.verification_url}`
        : "Registered. Please verify your email before generation.";
      setStatus(verifyText);
      await maybeResumeGenerateAfterAuth();
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (authLoginBtn) {
  authLoginBtn.addEventListener("click", async () => {
    try {
      const payload = {
        email: String(authEmailInput?.value || "").trim(),
        password: String(authPasswordInput?.value || "")
      };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Login failed.");
      await refreshAuthState(false);
      closeAuthModal({ clearResume: false });
      await maybeResumeGenerateAfterAuth();
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (authLogoutBtn) {
  authLogoutBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Logout failed.");
      state.authUser = null;
      state.authBalance = "0.0000";
      state.accountUsageLoading = false;
      state.accountSummary = null;
      closeAccountUsageModal();
      renderAuthUI();
      closeAdminModal();
      switchStep(2);
      setStatus("Logged out.");
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (authRefreshBtn) {
  authRefreshBtn.addEventListener("click", async () => {
    try {
      await refreshAuthState(false);
      if (accountUsageModal && !accountUsageModal.classList.contains("hidden")) {
        await refreshAccountUsageSummary();
      }
      setStatus("Account refreshed.");
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (openAccountUsageBtn) {
  openAccountUsageBtn.addEventListener("click", async () => {
    if (!hasAuth()) return;
    openAccountUsageModal();
    try {
      await refreshAccountUsageSummary();
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (adminRefreshBtn) {
  adminRefreshBtn.addEventListener("click", async () => {
    try {
      if (state.authUser?.role !== "ADMIN") throw new Error("Admin permission required.");
      await refreshAdminData();
      setStatus("Admin data refreshed.");
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (grantCreditsBtn) {
  grantCreditsBtn.addEventListener("click", async () => {
    try {
      if (state.authUser?.role !== "ADMIN") throw new Error("Admin permission required.");
      const userId = String(grantUserSelect?.value || "").trim();
      const amount = Number.parseFloat(String(grantAmountInput?.value || ""));
      const reason = String(grantReasonInput?.value || "admin usd grant").trim() || "admin usd grant";
      if (!userId) throw new Error("Please select a target user.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Grant USD amount must be > 0.");

      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/credits/grant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount_usd: amount,
          reason
        })
      });
      const data = await readApiResponse(res);
      if (!res.ok) throw new Error(data.error || "Failed to grant USD.");

      await refreshAdminData();
      await refreshAuthState();
      setStatus(`Granted ${data.amount_usd || data.amount_credits} USD.`);
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (adminVideoUserFilter) {
  adminVideoUserFilter.addEventListener("change", () => {
    state.adminVideoFilterUserId = String(adminVideoUserFilter.value || "").trim();
    renderAdminPanel();
  });
}

if (adminVideosTable) {
  adminVideosTable.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-video-detail-id]");
    if (!button) return;
    const usageEventId = String(button.getAttribute("data-video-detail-id") || "").trim();
    if (!usageEventId) return;
    try {
      await fetchAdminVideoDetail(usageEventId);
      setStatus(`Loaded video detail ${usageEventId}.`);
    } catch (error) {
      setStatus(`Error: ${error.message}`, "error");
    }
  });
}

if (openHistoryModalBtn) {
  openHistoryModalBtn.addEventListener("click", () => {
    setHistoryExpanded(true);
  });
}

if (closeHistoryModalBtn) {
  closeHistoryModalBtn.addEventListener("click", () => closeHistoryModal());
}

if (historyModal) {
  historyModal.addEventListener("click", (event) => {
    if (event.target === historyModal) closeHistoryModal();
  });
}

if (closeAccountUsageModalBtn) {
  closeAccountUsageModalBtn.addEventListener("click", () => closeAccountUsageModal());
}

if (accountUsageModal) {
  accountUsageModal.addEventListener("click", (event) => {
    if (event.target === accountUsageModal) closeAccountUsageModal();
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

if (openAuthModalBtn) {
  openAuthModalBtn.addEventListener("click", () => openAuthModal());
}

if (closeAuthModalBtn) {
  closeAuthModalBtn.addEventListener("click", () => closeAuthModal());
}

if (authModal) {
  authModal.addEventListener("click", (event) => {
    if (event.target === authModal) closeAuthModal();
  });
}

if (openAdminModalBtn) {
  openAdminModalBtn.addEventListener("click", () => openAdminModal());
}

if (closeAdminModalBtn) {
  closeAdminModalBtn.addEventListener("click", () => closeAdminModal());
}

if (adminConsoleModal) {
  adminConsoleModal.addEventListener("click", (event) => {
    if (event.target === adminConsoleModal) closeAdminModal();
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeImageZoom();
    closeAuthModal();
    closeAdminModal();
    closeHistoryModal();
    closeAccountUsageModal();
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
state.targetMarket = getTargetMarket();
renderSnapshot();
applyAdvancedPanelsVisibility();
setHistoryExpanded(false);
void refreshAuthState().catch(() => {});
switchStep(2);
