const express = require("express");
const multer = require("multer");
const path = require("path");
const os = require("os");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcryptjs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { AsyncLocalStorage } = require("async_hooks");
const { PrismaClient, Prisma } = require("@prisma/client");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const execFileAsync = promisify(execFile);
const requestContext = new AsyncLocalStorage();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PRODUCTION = NODE_ENV === "production";
const APP_BASE_URL = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).trim();
const SESSION_SECRET = String(process.env.SESSION_SECRET || "").trim();
const OPENAI_PLATFORM_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const XAI_PLATFORM_API_KEY = String(process.env.XAI_API_KEY || "").trim();
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const BALANCE_USD_PER_USD = 1;
const AUTH_RATE_LIMIT_WINDOW_MS =
  Number.parseInt(String(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "600000"), 10) || 600_000;
const AUTH_RATE_LIMIT_MAX = Number.parseInt(String(process.env.AUTH_RATE_LIMIT_MAX || "30"), 10) || 30;
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

const ALLOWED_RESOLUTIONS = new Set(["480p", "720p"]);
const ALLOWED_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"]);

if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET || "unsafe-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      maxAge: 1000 * 60 * 60 * 24 * 14
    }
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, "public")));

function normalizeDuration(value) {
  const duration = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(duration)) return null;
  if (duration < 1 || duration > 15) return null;
  return duration;
}

function toNumber(value, fallback = 0) {
  const next = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(next) ? next : fallback;
}

const DEFAULT_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K = toNumber(process.env.DEFAULT_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K, 0.0008);
const DEFAULT_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K = toNumber(process.env.DEFAULT_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K, 0.0032);
const DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1024 = toNumber(process.env.DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1024, 0.06);
const DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1536 = toNumber(process.env.DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1536, 0.09);
const DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1536x1024 = toNumber(process.env.DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1536x1024, 0.09);
const DEFAULT_PRICE_XAI_VIDEO_480P_PER_SECOND = toNumber(process.env.DEFAULT_PRICE_XAI_VIDEO_480P_PER_SECOND, 0.06);
const DEFAULT_PRICE_XAI_VIDEO_720P_PER_SECOND = toNumber(process.env.DEFAULT_PRICE_XAI_VIDEO_720P_PER_SECOND, 0.084);
const DEFAULT_PRICE_XAI_VIDEO_INPUT_IMAGE = toNumber(process.env.DEFAULT_PRICE_XAI_VIDEO_INPUT_IMAGE, 0.0024);
const COST_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K = toNumber(process.env.COST_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K, 0.0004);
const COST_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K = toNumber(process.env.COST_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K, 0.0016);
const COST_PRICE_OPENAI_IMAGE_EDITS_1024x1024 = toNumber(process.env.COST_PRICE_OPENAI_IMAGE_EDITS_1024x1024, 0.04);
const COST_PRICE_OPENAI_IMAGE_EDITS_1024x1536 = toNumber(process.env.COST_PRICE_OPENAI_IMAGE_EDITS_1024x1536, 0.06);
const COST_PRICE_OPENAI_IMAGE_EDITS_1536x1024 = toNumber(process.env.COST_PRICE_OPENAI_IMAGE_EDITS_1536x1024, 0.06);
const COST_PRICE_XAI_VIDEO_480P_PER_SECOND = toNumber(process.env.COST_PRICE_XAI_VIDEO_480P_PER_SECOND, 0.05);
const COST_PRICE_XAI_VIDEO_720P_PER_SECOND = toNumber(process.env.COST_PRICE_XAI_VIDEO_720P_PER_SECOND, 0.07);
const COST_PRICE_XAI_VIDEO_INPUT_IMAGE = toNumber(process.env.COST_PRICE_XAI_VIDEO_INPUT_IMAGE, 0.002);

function clampNonNegative(value) {
  return Math.max(0, toNumber(value, 0));
}

function buildPricingCatalogEntry({
  provider,
  operation,
  model = null,
  unitType,
  defaultPriceUsdPerUnit,
  costPriceUsdPerUnit = null,
  note = "",
  reviewOnFallback = false
}) {
  const price = clampNonNegative(defaultPriceUsdPerUnit);
  const costPrice = clampNonNegative(costPriceUsdPerUnit == null ? price : costPriceUsdPerUnit);
  return {
    provider,
    operation,
    model,
    unitType,
    defaultPriceUsdPerUnit: price,
    priceUsdPerUnit: price,
    costPriceUsdPerUnit: costPrice,
    note: String(note || ""),
    reviewOnFallback: Boolean(reviewOnFallback)
  };
}

function getDefaultPricingCatalog() {
  return [
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "chat.completions.input",
      model: AUTO_PROMPT_MODEL,
      unitType: "TOKENS_1K",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K,
      note: "OpenAI prompt generation input tokens."
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "chat.completions.output",
      model: AUTO_PROMPT_MODEL,
      unitType: "TOKENS_1K",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K,
      note: "OpenAI prompt generation output tokens."
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "chat.completions.input",
      model: null,
      unitType: "TOKENS_1K",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K,
      note: "Fallback for new OpenAI chat input model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "chat.completions.output",
      model: null,
      unitType: "TOKENS_1K",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K,
      note: "Fallback for new OpenAI chat output model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1024x1024",
      model: OPENAI_IMAGE_EDIT_MODEL,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1024,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1024x1024,
      note: "OpenAI image edit square size."
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1024x1536",
      model: OPENAI_IMAGE_EDIT_MODEL,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1536,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1024x1536,
      note: "OpenAI image edit portrait size."
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1536x1024",
      model: OPENAI_IMAGE_EDIT_MODEL,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1536x1024,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1536x1024,
      note: "OpenAI image edit landscape size."
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1024x1024",
      model: null,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1024,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1024x1024,
      note: "Fallback for new OpenAI image model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1024x1536",
      model: null,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1536,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1024x1536,
      note: "Fallback for new OpenAI image model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "OPENAI",
      operation: "images.edits.1536x1024",
      model: null,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1536x1024,
      costPriceUsdPerUnit: COST_PRICE_OPENAI_IMAGE_EDITS_1536x1024,
      note: "Fallback for new OpenAI image model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.480p",
      model: XAI_VIDEO_MODEL,
      unitType: "SECOND",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_480P_PER_SECOND,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_480P_PER_SECOND,
      note: "xAI video 480p per second."
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.720p",
      model: XAI_VIDEO_MODEL,
      unitType: "SECOND",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_720P_PER_SECOND,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_720P_PER_SECOND,
      note: "xAI video 720p per second."
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.input_image",
      model: XAI_VIDEO_MODEL,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_INPUT_IMAGE,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_INPUT_IMAGE,
      note: "xAI video input image per request."
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.480p",
      model: null,
      unitType: "SECOND",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_480P_PER_SECOND,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_480P_PER_SECOND,
      note: "Fallback for new xAI video model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.720p",
      model: null,
      unitType: "SECOND",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_720P_PER_SECOND,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_720P_PER_SECOND,
      note: "Fallback for new xAI video model; review required.",
      reviewOnFallback: true
    }),
    buildPricingCatalogEntry({
      provider: "XAI",
      operation: "video.generate.input_image",
      model: null,
      unitType: "IMAGE",
      defaultPriceUsdPerUnit: DEFAULT_PRICE_XAI_VIDEO_INPUT_IMAGE,
      costPriceUsdPerUnit: COST_PRICE_XAI_VIDEO_INPUT_IMAGE,
      note: "Fallback for new xAI input image pricing; review required.",
      reviewOnFallback: true
    })
  ];
}

const DEFAULT_PRICING_CATALOG = getDefaultPricingCatalog();

function toDecimalString(value, scale = 4) {
  const num = Number.parseFloat(String(value ?? 0));
  if (!Number.isFinite(num)) return (0).toFixed(scale);
  return num.toFixed(scale);
}

function normalizeTargetMarket(value) {
  const text = String(value || "").trim();
  return text || "Malaysia";
}

async function ensureAdminRoleByEmail(userId, email, currentRole) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!userId || !normalizedEmail) return null;
  const shouldBeAdmin = ADMIN_EMAILS.has(normalizedEmail);
  if (!shouldBeAdmin || String(currentRole || "").toUpperCase() === "ADMIN") return null;
  return prisma.user.update({
    where: { id: userId },
    data: { role: "ADMIN" }
  });
}

function isMalaysiaTargetMarket(value) {
  return normalizeTargetMarket(value).toLowerCase() === "malaysia";
}

function buildVideoPromptAppend(targetMarket) {
  const market = normalizeTargetMarket(targetMarket);
  if (isMalaysiaTargetMarket(market)) {
    return "If an input image is provided, use it as the FIRST FRAME (image-to-video). This video targets the TikTok Malaysia market, uses Malay people as characters, and uses urban Malay bahasa, which mixes Malay with English, for voice-over. Do not add on-screen text, logos, or watermarks.";
  }
  return `If an input image is provided, use it as the FIRST FRAME (image-to-video). This video targets the TikTok ${market} market. Use characters, voice-over language, and cultural context that naturally match ${market}. Do not add on-screen text, logos, or watermarks.`;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    email_verified: Boolean(user.emailVerifiedAt),
    created_at: user.createdAt
  };
}

function resolveOpenAiApiKey(_requestValue) {
  return String(OPENAI_PLATFORM_API_KEY || "").trim();
}

function resolveXaiApiKey(_requestValue) {
  return String(XAI_PLATFORM_API_KEY || "").trim();
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

const authRateState = new Map();
function authRateLimiter(req, res, next) {
  const now = Date.now();
  const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const key = String(ip);
  const current = authRateState.get(key) || { count: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + AUTH_RATE_LIMIT_WINDOW_MS;
  }
  current.count += 1;
  authRateState.set(key, current);
  if (current.count > AUTH_RATE_LIMIT_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.setHeader("Retry-After", retryAfterSec);
    return res.status(429).json({ error: "Too many auth requests. Try again later." });
  }
  return next();
}

async function logAudit({ actorUserId = null, targetUserId = null, action, payload = null, req = null }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        targetUserId,
        action: String(action || "").slice(0, 120),
        payload: payload || null,
        ipAddress: req?.ip || null,
        userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 500) || null
      }
    });
  } catch (error) {
    console.error("audit_log_error", error.message);
  }
}

async function getUserBalance(userId) {
  if (!userId) return 0;
  const latest = await prisma.creditLedger.findFirst({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { balanceAfter: true }
  });
  return toNumber(latest?.balanceAfter, 0);
}

async function appendLedgerEntry({
  userId,
  type,
  amountCredits,
  reason = null,
  metadata = null,
  costUsd = null,
  createdByUserId = null,
  usageEventId = null
}) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.creditLedger.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { balanceAfter: true }
    });
    const previousBalance = toNumber(latest?.balanceAfter, 0);
    const delta = toNumber(amountCredits, 0);
    const balanceAfter = previousBalance + delta;
    const entry = await tx.creditLedger.create({
      data: {
        userId,
        type,
        amountCredits: toDecimalString(delta, 4),
        balanceAfter: toDecimalString(balanceAfter, 4),
        reason,
        metadata: metadata || null,
        costUsd: costUsd == null ? null : toDecimalString(costUsd, 6),
        createdByUserId,
        usageEventId
      }
    });
    return { entry, balanceAfter };
  });
}

async function getActivePricingSnapshot({ provider, operation, model, unitType }) {
  const now = new Date();
  const exact = await prisma.pricingSnapshot.findFirst({
    where: {
      isActive: true,
      provider,
      operation,
      model: model || null,
      unitType,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
  });
  if (exact) return exact;
  return prisma.pricingSnapshot.findFirst({
    where: {
      isActive: true,
      provider,
      operation,
      model: null,
      unitType,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
    },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }]
  });
}

function getOperationCandidates(operation) {
  const raw = String(operation || "").trim();
  if (!raw) return [""];
  const parts = raw.split(".").filter(Boolean);
  const variants = [raw];
  for (let cut = parts.length - 1; cut >= 2; cut -= 1) {
    variants.push(parts.slice(0, cut).join("."));
  }
  return [...new Set(variants)];
}

function getDefaultPricingCatalogForConsole() {
  return DEFAULT_PRICING_CATALOG.filter((entry) => entry.model).map((entry) => ({
    provider: entry.provider,
    operation: entry.operation,
    model: entry.model,
    unit_type: entry.unitType,
    cost_price_usd_per_unit: toDecimalString(entry.costPriceUsdPerUnit, 8),
    default_price_usd_per_unit: toDecimalString(entry.priceUsdPerUnit, 8),
    markup_multiplier:
      entry.costPriceUsdPerUnit > 0
        ? toDecimalString(entry.priceUsdPerUnit / entry.costPriceUsdPerUnit, 4)
        : null,
    gross_margin_usd_per_unit: toDecimalString(entry.priceUsdPerUnit - entry.costPriceUsdPerUnit, 8),
    note: entry.note
  }));
}

function resolveDefaultCatalogPricing({ provider, operation, model, unitType }) {
  const providerKey = String(provider || "").toUpperCase();
  const modelKey = String(model || "").trim() || null;
  const unitKey = String(unitType || "").trim().toUpperCase();
  const operationCandidates = getOperationCandidates(operation);
  const requestedOperation = String(operation || "").trim();

  for (const opCandidate of operationCandidates) {
    if (modelKey) {
      const exact = DEFAULT_PRICING_CATALOG.find(
        (entry) =>
          entry.provider === providerKey &&
          entry.operation === opCandidate &&
          entry.unitType === unitKey &&
          entry.model === modelKey
      );
      if (exact) {
        return {
          entry: exact,
          matchedOperation: opCandidate,
          priceUsdPerUnit: exact.priceUsdPerUnit,
          pricingSource: opCandidate === requestedOperation ? "default_catalog_exact" : "default_catalog_operation_fallback",
          pricingReviewRequired: false,
          pricingReviewMessage: null
        };
      }
    }

    const fallback = DEFAULT_PRICING_CATALOG.find(
      (entry) =>
        entry.provider === providerKey &&
        entry.operation === opCandidate &&
        entry.unitType === unitKey &&
        entry.model === null
    );
    if (fallback) {
      const opFallback = opCandidate !== requestedOperation;
      const modelFallback = Boolean(modelKey);
      const needsReview = Boolean(fallback.reviewOnFallback || opFallback || modelFallback);
      const reasons = [];
      if (modelFallback) reasons.push(`model '${modelKey}' is not mapped`);
      if (opFallback) reasons.push(`operation '${requestedOperation}' fell back to '${opCandidate}'`);
      if (!reasons.length && needsReview) reasons.push("fallback default price was used");
      return {
        entry: fallback,
        matchedOperation: opCandidate,
        priceUsdPerUnit: fallback.priceUsdPerUnit,
        pricingSource: opFallback ? "default_catalog_operation_fallback" : "default_catalog_model_fallback",
        pricingReviewRequired: needsReview,
        pricingReviewMessage: needsReview
          ? `Pricing review required: ${reasons.join("; ")}. Add/update pricing in Admin Console.`
          : null
      };
    }
  }

  const opText = String(operation || "").trim() || "(missing)";
  return {
    entry: null,
    matchedOperation: opText,
    priceUsdPerUnit: 0,
    pricingSource: "default_missing",
    pricingReviewRequired: true,
    pricingReviewMessage: `Pricing review required: no default pricing rule for ${providerKey}/${opText}/${unitKey}${modelKey ? ` (model=${modelKey})` : ""}. Add a pricing snapshot in Admin Console.`
  };
}

function resolveDefaultCatalogCostPricing({ provider, operation, model, unitType }) {
  const providerKey = String(provider || "").toUpperCase();
  const modelKey = String(model || "").trim() || null;
  const unitKey = String(unitType || "").trim().toUpperCase();
  const operationCandidates = getOperationCandidates(operation);

  for (const opCandidate of operationCandidates) {
    if (modelKey) {
      const exact = DEFAULT_PRICING_CATALOG.find(
        (entry) =>
          entry.provider === providerKey &&
          entry.operation === opCandidate &&
          entry.unitType === unitKey &&
          entry.model === modelKey
      );
      if (exact) {
        return {
          entry: exact,
          costPriceUsdPerUnit: toNumber(exact.costPriceUsdPerUnit, 0)
        };
      }
    }

    const fallback = DEFAULT_PRICING_CATALOG.find(
      (entry) =>
        entry.provider === providerKey &&
        entry.operation === opCandidate &&
        entry.unitType === unitKey &&
        entry.model === null
    );
    if (fallback) {
      return {
        entry: fallback,
        costPriceUsdPerUnit: toNumber(fallback.costPriceUsdPerUnit, 0)
      };
    }
  }

  return {
    entry: null,
    costPriceUsdPerUnit: 0
  };
}

function estimatePlatformCostFromUsageEvent(event) {
  if (!event) return 0;
  const provider = String(event.provider || "").toUpperCase();
  const operation = String(event.operation || "");
  const model = String(event.model || "").trim() || null;
  const unitType = String(event.unitType || "").toUpperCase();
  const raw = event.raw && typeof event.raw === "object" ? event.raw : null;

  if (provider === "OPENAI" && operation === "chat.completions") {
    const pricingBreakdown = Array.isArray(raw?.pricing_breakdown) ? raw.pricing_breakdown : [];
    if (pricingBreakdown.length) {
      let total = 0;
      pricingBreakdown.forEach((item) => {
        const op = String(item?.operation || "").trim();
        const usageUnits = Math.max(0, toNumber(item?.usage_units, 0));
        if (!op || usageUnits <= 0) return;
        const costResolution = resolveDefaultCatalogCostPricing({
          provider,
          operation: op,
          model,
          unitType: "TOKENS_1K"
        });
        total += usageUnits * Math.max(0, costResolution.costPriceUsdPerUnit);
      });
      if (total > 0) return total;
    }
  }

  const usageUnits = computeUsageUnits({
    unitType,
    totalUnits: toNumber(event.totalUnits, 0),
    durationSeconds: toNumber(event.durationSeconds, null)
  });
  const costResolution = resolveDefaultCatalogCostPricing({
    provider,
    operation,
    model,
    unitType
  });
  const unitCost = Math.max(0, costResolution.costPriceUsdPerUnit);
  if (usageUnits > 0 && unitCost > 0) {
    return usageUnits * unitCost;
  }
  return Math.max(0, toNumber(event.costUsd, 0));
}

async function resolveUsagePricing({ provider, operation, model, unitType }) {
  const providerKey = String(provider || "").toUpperCase();
  const unitKey = String(unitType || "").toUpperCase();
  const operationCandidates = getOperationCandidates(operation);
  const defaultPricing = resolveDefaultCatalogPricing({
    provider: providerKey,
    operation,
    model,
    unitType: unitKey
  });
  const defaultPriceUsdPerUnit = toNumber(defaultPricing.priceUsdPerUnit, 0);

  for (const operationCandidate of operationCandidates) {
    const pricing = await getActivePricingSnapshot({
      provider: providerKey,
      operation: operationCandidate,
      model,
      unitType: unitKey
    });
    if (!pricing) continue;
    const snapshotPriceUsdPerUnit = toNumber(pricing.priceUsdPerUnit, 0);
    if (snapshotPriceUsdPerUnit > 0 || defaultPriceUsdPerUnit <= 0) {
      return {
        pricing,
        matchedOperation: operationCandidate,
        fallbackPricingSnapshotId: null,
        priceUsdPerUnit: snapshotPriceUsdPerUnit,
        balanceUsdPerUsd: BALANCE_USD_PER_USD,
        pricingSource: operationCandidate === operation ? "pricing_snapshot" : "pricing_snapshot_operation_fallback",
        pricingReviewRequired: false,
        pricingReviewMessage: null
      };
    }
    return {
      pricing: null,
      matchedOperation: defaultPricing.matchedOperation || operationCandidate,
      fallbackPricingSnapshotId: pricing.id,
      priceUsdPerUnit: defaultPriceUsdPerUnit,
      balanceUsdPerUsd: BALANCE_USD_PER_USD,
      pricingSource: "pricing_snapshot_non_positive_fallback",
      pricingReviewRequired: Boolean(defaultPricing.pricingReviewRequired),
      pricingReviewMessage: defaultPricing.pricingReviewMessage || null
    };
  }

  return {
    pricing: null,
    matchedOperation: defaultPricing.matchedOperation || String(operation || ""),
    fallbackPricingSnapshotId: null,
    priceUsdPerUnit: defaultPriceUsdPerUnit,
    balanceUsdPerUsd: BALANCE_USD_PER_USD,
    pricingSource: defaultPricing.pricingSource || "default_missing",
    pricingReviewRequired: Boolean(defaultPricing.pricingReviewRequired),
    pricingReviewMessage: defaultPricing.pricingReviewMessage || null
  };
}

function computeUsageUnits({ unitType, totalUnits = 0, durationSeconds = null }) {
  if (unitType === "TOKENS_1K") return toNumber(totalUnits, 0) / 1000;
  if (unitType === "SECOND") return Math.max(0, toNumber(durationSeconds, 0));
  if (unitType === "REQUEST" || unitType === "IMAGE") return 1;
  return Math.max(0, toNumber(totalUnits, 0));
}

async function estimateCreditsForUsage({ provider, operation, model = null, unitType, totalUnits = 0, durationSeconds = null }) {
  const usageUnits = computeUsageUnits({ unitType, totalUnits, durationSeconds });
  const resolvedPricing = await resolveUsagePricing({ provider, operation, model, unitType });
  const {
    pricing,
    fallbackPricingSnapshotId,
    priceUsdPerUnit,
    balanceUsdPerUsd,
    pricingSource,
    pricingReviewRequired,
    pricingReviewMessage
  } = resolvedPricing;
  const costUsd = usageUnits * priceUsdPerUnit;
  const debitUsd = costUsd * balanceUsdPerUsd;
  return {
    usageUnits,
    costUsd,
    debitUsd,
    credits: debitUsd,
    pricing,
    fallback_pricing_snapshot_id: fallbackPricingSnapshotId || null,
    price_usd_per_unit: priceUsdPerUnit,
    pricing_source: pricingSource,
    pricing_review_required: Boolean(pricingReviewRequired),
    pricing_review_message: pricingReviewMessage || null
  };
}

async function recordUsageEventAndDebit({
  userId,
  provider,
  operation,
  model = null,
  unitType,
  inputUnits = null,
  outputUnits = null,
  totalUnits = 0,
  durationSeconds = null,
  requestId = null,
  raw = null
}) {
  if (!userId) return null;
  let usageUnits = computeUsageUnits({ unitType, totalUnits, durationSeconds });
  let pricing = null;
  let fallbackPricingSnapshotId = null;
  let priceUsdPerUnit = null;
  let pricingSource = "default_missing";
  let pricingReviewRequired = false;
  let pricingReviewMessage = null;
  let costUsd = 0;
  let debitUsd = 0;
  let pricingBreakdown = null;

  if (String(provider || "").toUpperCase() === "OPENAI" && String(operation || "").toLowerCase() === "chat.completions") {
    const promptTokens = Math.max(0, toNumber(inputUnits, 0));
    const completionTokens = Math.max(0, toNumber(outputUnits, 0));
    const inputPart = await estimateCreditsForUsage({
      provider,
      operation: "chat.completions.input",
      model,
      unitType: "TOKENS_1K",
      totalUnits: promptTokens
    });
    const outputPart = await estimateCreditsForUsage({
      provider,
      operation: "chat.completions.output",
      model,
      unitType: "TOKENS_1K",
      totalUnits: completionTokens
    });
    usageUnits = inputPart.usageUnits + outputPart.usageUnits;
    costUsd = inputPart.costUsd + outputPart.costUsd;
    debitUsd = inputPart.debitUsd + outputPart.debitUsd;
    pricingSource = `${inputPart.pricing_source}+${outputPart.pricing_source}`;
    priceUsdPerUnit = usageUnits > 0 ? costUsd / usageUnits : 0;
    const inputSnapshotId = inputPart?.pricing?.id || null;
    const outputSnapshotId = outputPart?.pricing?.id || null;
    if (inputSnapshotId && outputSnapshotId && inputSnapshotId === outputSnapshotId) {
      pricing = inputPart.pricing;
    }
    fallbackPricingSnapshotId =
      inputPart?.fallback_pricing_snapshot_id ||
      outputPart?.fallback_pricing_snapshot_id ||
      null;
    pricingReviewRequired = Boolean(inputPart.pricing_review_required || outputPart.pricing_review_required);
    pricingReviewMessage = [inputPart.pricing_review_message, outputPart.pricing_review_message].filter(Boolean).join(" | ") || null;
    pricingBreakdown = [
      {
        stream: "input",
        operation: "chat.completions.input",
        tokens: promptTokens,
        usage_units: inputPart.usageUnits,
        cost_usd: toDecimalString(inputPart.costUsd, 6),
        price_usd_per_unit: toDecimalString(inputPart.price_usd_per_unit, 8),
        pricing_source: inputPart.pricing_source,
        pricing_review_required: Boolean(inputPart.pricing_review_required),
        pricing_review_message: inputPart.pricing_review_message || null
      },
      {
        stream: "output",
        operation: "chat.completions.output",
        tokens: completionTokens,
        usage_units: outputPart.usageUnits,
        cost_usd: toDecimalString(outputPart.costUsd, 6),
        price_usd_per_unit: toDecimalString(outputPart.price_usd_per_unit, 8),
        pricing_source: outputPart.pricing_source,
        pricing_review_required: Boolean(outputPart.pricing_review_required),
        pricing_review_message: outputPart.pricing_review_message || null
      }
    ];
  } else {
    const resolvedPricing = await resolveUsagePricing({ provider, operation, model, unitType });
    pricing = resolvedPricing.pricing || null;
    fallbackPricingSnapshotId = resolvedPricing.fallbackPricingSnapshotId || null;
    priceUsdPerUnit = resolvedPricing.priceUsdPerUnit;
    pricingSource = resolvedPricing.pricingSource;
    pricingReviewRequired = Boolean(resolvedPricing.pricingReviewRequired);
    pricingReviewMessage = resolvedPricing.pricingReviewMessage || null;
    costUsd = usageUnits * priceUsdPerUnit;
    debitUsd = costUsd * resolvedPricing.balanceUsdPerUsd;
  }

  return prisma.$transaction(async (tx) => {
    const usageEvent = await tx.usageEvent.create({
      data: {
        userId,
        provider,
        operation,
        model,
        unitType,
        inputUnits: inputUnits == null ? null : toDecimalString(inputUnits, 6),
        outputUnits: outputUnits == null ? null : toDecimalString(outputUnits, 6),
        totalUnits: toDecimalString(totalUnits, 6),
        durationSeconds,
        costUsd: toDecimalString(costUsd, 6),
        creditsDeducted: toDecimalString(debitUsd, 4),
        requestId,
        pricingSnapshotId: pricing?.id || null,
        raw: {
          ...(raw && typeof raw === "object" ? raw : {}),
          pricing_source: pricingSource,
          fallback_pricing_snapshot_id: fallbackPricingSnapshotId || null,
          price_usd_per_unit: priceUsdPerUnit == null ? null : toDecimalString(priceUsdPerUnit, 8),
          pricing_breakdown: pricingBreakdown,
          pricing_review_required: pricingReviewRequired,
          pricing_review_message: pricingReviewMessage,
          debit_usd: toDecimalString(debitUsd, 6)
        }
      }
    });

    if (debitUsd > 0) {
      const latest = await tx.creditLedger.findFirst({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { balanceAfter: true }
      });
      const previousBalance = toNumber(latest?.balanceAfter, 0);
      const balanceAfter = previousBalance - debitUsd;
      await tx.creditLedger.create({
        data: {
          userId,
          type: "USAGE_DEBIT",
          amountCredits: toDecimalString(-debitUsd, 4),
          balanceAfter: toDecimalString(balanceAfter, 4),
          reason: `${provider}:${operation}`,
          costUsd: toDecimalString(costUsd, 6),
          usageEventId: usageEvent.id
        }
      });
    }
    return usageEvent;
  });
}

function requireAuth(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required." });
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required." });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin permission required." });
  return next();
}

function requireVerifiedEmail(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required." });
  return next();
}

async function requirePositiveCredits(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: "Authentication required." });
  const balance = await getUserBalance(req.user.id);
  req.userBalanceUsd = balance;
  if (balance <= 0) {
    return res.status(402).json({
      error: "Insufficient balance. Ask admin to grant USD balance.",
      balance_usd: toDecimalString(balance, 4),
      balance_credits: toDecimalString(balance, 4)
    });
  }
  return next();
}

function inferLocalStrategyUsername(email, seed = "") {
  const base = String(email || "").split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20) || "user";
  if (!seed) return base;
  return `${base}_${seed}`.slice(0, 31);
}

async function allocateUniqueUsername(email) {
  const baseCandidate = inferLocalStrategyUsername(email);
  const baseTaken = await prisma.user.findUnique({
    where: { username: baseCandidate },
    select: { id: true }
  });
  if (!baseTaken) return baseCandidate;

  for (let i = 0; i < 8; i += 1) {
    const seed = randomToken(4).slice(0, 6);
    const candidate = inferLocalStrategyUsername(email, seed);
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true }
    });
    if (!taken) return candidate;
  }
  return inferLocalStrategyUsername(email, Date.now().toString(36));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (userId, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const GOOGLE_CALLBACK_URL = String(
  process.env.GOOGLE_CALLBACK_URL || `${APP_BASE_URL}/api/auth/google/callback`
).trim();

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const googleId = String(profile?.id || "").trim();
          const email = String(profile?.emails?.[0]?.value || "").trim().toLowerCase();
          if (!googleId || !email) {
            return done(new Error("Google account missing id/email."));
          }

          const existingIdentity = await prisma.authIdentity.findUnique({
            where: { provider_providerUserId: { provider: "GOOGLE", providerUserId: googleId } },
            include: { user: true }
          });
          if (existingIdentity?.user) {
            const loginUpdated = await prisma.user.update({
              where: { id: existingIdentity.user.id },
              data: { lastLoginAt: new Date(), emailVerifiedAt: existingIdentity.user.emailVerifiedAt || new Date() }
            });
            const adminPromoted = await ensureAdminRoleByEmail(
              loginUpdated.id,
              loginUpdated.email,
              loginUpdated.role
            );
            return done(null, adminPromoted || loginUpdated);
          }

          const existingByEmail = await prisma.user.findUnique({ where: { email } });
          if (existingByEmail) {
            await prisma.authIdentity.create({
              data: {
                userId: existingByEmail.id,
                provider: "GOOGLE",
                providerUserId: googleId
              }
            });
            const updated = await prisma.user.update({
              where: { id: existingByEmail.id },
              data: { emailVerifiedAt: existingByEmail.emailVerifiedAt || new Date(), lastLoginAt: new Date() }
            });
            const adminPromoted = await ensureAdminRoleByEmail(updated.id, updated.email, updated.role);
            return done(null, adminPromoted || updated);
          }

          const suffix = randomToken(4).slice(0, 6);
          const username = inferLocalStrategyUsername(email, suffix);
          const role = ADMIN_EMAILS.has(email) ? "ADMIN" : "USER";
          const created = await prisma.user.create({
            data: {
              email,
              username,
              role,
              emailVerifiedAt: new Date(),
              lastLoginAt: new Date(),
              authIdentities: {
                create: [{ provider: "GOOGLE", providerUserId: googleId }]
              }
            }
          });
          return done(null, created);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

app.use((req, _res, next) => {
  requestContext.run(
    {
      route: req.path,
      user: req.user ? { id: req.user.id, role: req.user.role } : null
    },
    next
  );
});

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

function toDataUriWithLimit(file, maxBytes = 3_000_000) {
  if (!file?.buffer) return null;
  const size = toNumber(file.size, file.buffer.length);
  if (size > maxBytes) return null;
  return toDataUri(file);
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

function decodeDataUri(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  try {
    return {
      mime: match[1] || "image/png",
      buffer: Buffer.from(match[2], "base64")
    };
  } catch {
    return null;
  }
}

function encodeDataUri(buffer, mime = "image/png") {
  if (!Buffer.isBuffer(buffer)) return "";
  return `data:${mime};base64,${buffer.toString("base64")}`;
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

function normalizeOpenAiImageSizeForPricing(size) {
  const normalized = String(size || "").trim().toLowerCase();
  if (normalized === "1024x1024") return "1024x1024";
  if (normalized === "1024x1536") return "1024x1536";
  if (normalized === "1536x1024") return "1536x1024";
  return "1024x1024";
}

function getOpenAiImagePricingOperation(size) {
  return `images.edits.${normalizeOpenAiImageSizeForPricing(size)}`;
}

function normalizeResolutionForPricing(resolution) {
  const normalized = String(resolution || "").trim().toLowerCase();
  if (normalized === "720p") return "720p";
  return "480p";
}

function getXaiVideoPricingOperation(resolution) {
  return `video.generate.${normalizeResolutionForPricing(resolution)}`;
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

async function generateVideoPromptFromScene({ openaiApiKey, imageFile, scene, duration, targetMarket }) {
  const normalizedScene = normalizeSceneDirectionItem(scene);
  if (!normalizedScene) {
    const err = new Error("scene is required.");
    err.openaiStatus = 400;
    throw err;
  }

  const imageUrl = toDataUri(imageFile);
  const imagePreview = summarizeDataUri(imageUrl);
  const directionBrief = buildSceneBrief(normalizedScene);
  const normalizedMarket = normalizeTargetMarket(targetMarket);
  const malaysiaMarket = isMalaysiaTargetMarket(normalizedMarket);
  const modelDesignRequirement = malaysiaMarket
    ? "Malay model design"
    : `model design suitable for ${normalizedMarket} audience`;
  const voiceRequirement = malaysiaMarket
    ? `urban Malay bahasa, which mixes Malay with English, voice-over script paced for ${duration} seconds`
    : `voice-over script paced for ${duration} seconds in the most natural local language/style for ${normalizedMarket}`;
  const mandatoryMarketRequirement = malaysiaMarket
    ? "target TikTok Malaysia, Malay people as characters, voice-over must use urban Malay bahasa, which mixes Malay with English"
    : `target TikTok ${normalizedMarket}, and use characters + voice-over language + cultural context that naturally fit ${normalizedMarket}`;

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
              `Convert this scene direction into one final video-generation prompt:\n${directionBrief}\n\nThe final prompt must fit ${duration} seconds and include: 1) video concept and hook, 2) ${modelDesignRequirement}, 3) scene/background/environment, 4) camera and motion plan, 5) ${voiceRequirement}, 6) selling points and CTA, 7) voice age/tone design aligned to the ages described in scene direction/scene_keywords/characters, 8) one explicit line: "Voice-over speaker age: <exact age or tight range>" chosen as the most suitable voice age for this scene and buying persona. If multiple ages exist in the scene, pick the best primary narrator age and state it explicitly. Mandatory constraints: ${mandatoryMarketRequirement}, do NOT reuse the original reference image background/environment, no on-screen text/logos/watermarks. The attached image is the generated first-frame image for this exact scene: use it as the opening-frame reference and preserve opening-shot continuity for composition, characters, pose, clothing details, camera angle, and framing.`
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
  if (response.ok) {
    const ctx = requestContext.getStore();
    if (ctx?.user?.id) {
      try {
        await recordUsageEventAndDebit({
          userId: ctx.user.id,
          provider: "OPENAI",
          operation: "chat.completions",
          model: body?.model || data?.model || null,
          unitType: "TOKENS_1K",
          inputUnits: data?.usage?.prompt_tokens ?? null,
          outputUnits: data?.usage?.completion_tokens ?? null,
          totalUnits:
            data?.usage?.total_tokens ??
            toNumber(data?.usage?.prompt_tokens, 0) + toNumber(data?.usage?.completion_tokens, 0),
          requestId: data?.id || null,
          raw: { usage: data?.usage || null, route: ctx.route || null }
        });
      } catch (error) {
        console.error("usage_meter_chat_error", error.message);
      }
    }
  }
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
  if (response.ok) {
    const ctx = requestContext.getStore();
    if (ctx?.user?.id) {
      try {
        await recordUsageEventAndDebit({
          userId: ctx.user.id,
          provider: "OPENAI",
          operation: getOpenAiImagePricingOperation(size),
          model: OPENAI_IMAGE_EDIT_MODEL,
          unitType: "IMAGE",
          totalUnits: 1,
          requestId: data?.created ? String(data.created) : null,
          raw: {
            output_count: Array.isArray(data?.data) ? data.data.length : 0,
            image_size: normalizeOpenAiImageSizeForPricing(size),
            route: ctx.route || null
          }
        });
      } catch (error) {
        console.error("usage_meter_image_error", error.message);
      }
    }
  }
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

    return JSON.parse(stdout || "{}");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function cropImageBufferToAspectRatio({ imageBuffer, aspectRatio }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-crop-"));
  const inputPath = path.join(tempDir, "input.png");
  const outputPath = path.join(tempDir, "output.png");
  const scriptPath = path.join(__dirname, "scripts", "crop_image_to_aspect_ratio.py");
  const ratioRaw = String(aspectRatio || "").trim();

  try {
    await fs.writeFile(inputPath, imageBuffer);

    const { stdout, stderr } = await execFileAsync(PYTHON_BIN, [scriptPath, inputPath, outputPath, ratioRaw], {
      env: process.env,
      maxBuffer: 4 * 1024 * 1024
    });

    if (stderr && stderr.trim()) {
      throw new Error(stderr.trim());
    }

    const croppedBuffer = await fs.readFile(outputPath);
    let cropMeta = {};
    try {
      cropMeta = JSON.parse(String(stdout || "{}").trim() || "{}");
    } catch {
      cropMeta = {};
    }

    return {
      buffer: croppedBuffer,
      mime: "image/png",
      meta: cropMeta
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

app.use("/api", (req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const userId = req.user?.id || null;
    const method = req.method || "";
    const route = req.path || "";
    const statusCode = res.statusCode || 0;
    const requestBytes = Number.parseInt(String(req.headers["content-length"] || ""), 10) || null;
    const responseBytes = Number.parseInt(String(res.getHeader("content-length") || ""), 10) || null;
    const errorMessage = statusCode >= 500 ? "server_error" : null;
    prisma.apiLog
      .create({
        data: {
          userId,
          method,
          route,
          statusCode,
          latencyMs,
          requestBytes,
          responseBytes,
          errorMessage
        }
      })
      .catch(() => {});
  });
  return next();
});

app.get("/api/config", (_req, res) => {
  return res.json({
    platform_api_keys: {
      openai: Boolean(OPENAI_PLATFORM_API_KEY),
      xai: Boolean(XAI_PLATFORM_API_KEY)
    },
    google_oauth_enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    app_base_url: APP_BASE_URL
  });
});

app.get("/api/auth/me", async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.json({
        authenticated: false,
        user: null,
        balance_usd: "0.0000",
        balance_credits: "0.0000",
        google_oauth_enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
        platform_api_keys: {
          openai: Boolean(OPENAI_PLATFORM_API_KEY),
          xai: Boolean(XAI_PLATFORM_API_KEY)
        }
      });
    }
    const balance = await getUserBalance(req.user.id);
    return res.json({
      authenticated: true,
      user: sanitizeUser(req.user),
      balance_usd: toDecimalString(balance, 4),
      balance_credits: toDecimalString(balance, 4),
      google_oauth_enabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      platform_api_keys: {
        openai: Boolean(OPENAI_PLATFORM_API_KEY),
        xai: Boolean(XAI_PLATFORM_API_KEY)
      }
    });
  } catch (error) {
    console.error("auth_me_error", error);
    return res.status(500).json({ error: "Failed to load auth state." });
  }
});

app.post("/api/auth/register", authRateLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const role = ADMIN_EMAILS.has(email) ? "ADMIN" : "USER";

  try {
    let user = null;
    let username = "";
    for (let attempt = 0; attempt < 4 && !user; attempt += 1) {
      username = await allocateUniqueUsername(email);
      try {
        user = await prisma.user.create({
          data: {
            email,
            username,
            passwordHash,
            role,
            authIdentities: { create: [{ provider: "LOCAL", providerUserId: email }] },
          }
        });
      } catch (error) {
        const target = Array.isArray(error?.meta?.target)
          ? error.meta.target.map((item) => String(item).toLowerCase())
          : [];
        const isUsernameConflict = error?.code === "P2002" && target.some((item) => item.includes("username"));
        if (isUsernameConflict) continue;
        throw error;
      }
    }
    if (!user) {
      return res.status(500).json({ error: "Failed to create account username. Please retry." });
    }

    await logAudit({
      actorUserId: user.id,
      targetUserId: user.id,
      action: "auth.register",
      payload: { email, role },
      req
    });

    req.login(user, async (error) => {
      if (error) {
        return res.status(500).json({ error: "Registered but failed to create session." });
      }
      const balance = await getUserBalance(user.id);
      return res.status(201).json({
        user: sanitizeUser(user),
        balance_usd: toDecimalString(balance, 4),
        balance_credits: toDecimalString(balance, 4)
      });
    });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "Email already exists." });
    }
    return res.status(500).json({ error: "Failed to register account." });
  }
});

app.post("/api/auth/login", authRateLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || req.body.identifier || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials." });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    let updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    const adminPromoted = await ensureAdminRoleByEmail(updatedUser.id, updatedUser.email, updatedUser.role);
    if (adminPromoted) updatedUser = adminPromoted;
    await logAudit({
      actorUserId: updatedUser.id,
      targetUserId: updatedUser.id,
      action: "auth.login",
      payload: { email },
      req
    });

    req.login(updatedUser, async (error) => {
      if (error) return res.status(500).json({ error: "Failed to establish session." });
      const balance = await getUserBalance(updatedUser.id);
      return res.json({
        user: sanitizeUser(updatedUser),
        balance_usd: toDecimalString(balance, 4),
        balance_credits: toDecimalString(balance, 4)
      });
    });
  } catch (error) {
    console.error("auth_login_error", error);
    return res.status(500).json({ error: "Failed to login. Please retry." });
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res) => {
  const actorUserId = req.user.id;
  req.logout((error) => {
    if (error) return res.status(500).json({ error: "Failed to logout." });
    req.session.destroy(() => {
      logAudit({ actorUserId, targetUserId: actorUserId, action: "auth.logout", req }).catch(() => {});
      return res.json({ status: "ok" });
    });
  });
});

app.get("/api/auth/verify-email", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required." });
  const tokenHash = sha256(token);

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
  if (!record) return res.status(400).json({ error: "Invalid token." });
  if (record.usedAt) return res.status(400).json({ error: "Token already used." });
  if (record.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: "Token expired." });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() }
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    })
  ]);

  await logAudit({
    actorUserId: record.userId,
    targetUserId: record.userId,
    action: "auth.verify_email",
    payload: { tokenId: record.id },
    req
  });
  return res.json({ status: "verified" });
});

app.get("/api/auth/google", (req, res, next) => {
  if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)) {
    return res.status(503).json({ error: "Google OAuth is not configured." });
  }
  return passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get("/api/auth/google/callback", (req, res, next) => {
  if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)) {
    return res.redirect("/?auth_error=google_not_configured");
  }
  passport.authenticate("google", { failureRedirect: "/?auth_error=google_login_failed" })(
    req,
    res,
    async () => {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { lastLoginAt: new Date(), emailVerifiedAt: req.user.emailVerifiedAt || new Date() }
      });
      await logAudit({
        actorUserId: req.user.id,
        targetUserId: req.user.id,
        action: "auth.login_google",
        req
      });
      return res.redirect("/?auth=google_success");
    }
  );
});

app.get("/api/credits/balance", requireAuth, async (req, res) => {
  const balance = await getUserBalance(req.user.id);
  return res.json({
    user_id: req.user.id,
    balance_usd: toDecimalString(balance, 4),
    balance_credits: toDecimalString(balance, 4)
  });
});

app.get("/api/usage/me", requireAuth, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit || "50"), 10) || 50));
  const usageEvents = await prisma.usageEvent.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return res.json({
    usage_events: usageEvents.map((event) => ({
      ...event,
      cost_usd: toDecimalString(event.costUsd, 6),
      debit_usd: toDecimalString(event.costUsd, 6),
      credits_deducted: toDecimalString(event.costUsd, 6)
    }))
  });
});

app.get("/api/account/summary", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const [balance, ledgerRows, usageRowsAll, recentUsageRows, paymentRows] = await Promise.all([
    getUserBalance(userId),
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { type: true, amountCredits: true, createdAt: true }
    }),
    prisma.usageEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.usageEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 80
    }),
    prisma.payment.findMany({
      where: { userId, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      select: { amountUsd: true, createdAt: true }
    })
  ]);

  let grantedUsd = 0;
  for (const row of ledgerRows) {
    if (row.type === "ADMIN_GRANT") {
      grantedUsd += Math.max(0, toNumber(row.amountCredits, 0));
    }
  }
  const rechargedUsd = paymentRows.reduce((sum, row) => sum + Math.max(0, toNumber(row.amountUsd, 0)), 0);

  let usedUsd = 0;
  let openaiCostUsd = 0;
  let xaiCostUsd = 0;
  let platformCostEstimatedUsd = 0;
  let openaiPlatformCostEstimatedUsd = 0;
  let xaiPlatformCostEstimatedUsd = 0;
  for (const row of usageRowsAll) {
    const cost = Math.max(0, toNumber(row.costUsd, 0));
    const platformCost = estimatePlatformCostFromUsageEvent(row);
    usedUsd += cost;
    platformCostEstimatedUsd += platformCost;
    if (row.provider === "OPENAI") {
      openaiCostUsd += cost;
      openaiPlatformCostEstimatedUsd += platformCost;
    }
    if (row.provider === "XAI") {
      xaiCostUsd += cost;
      xaiPlatformCostEstimatedUsd += platformCost;
    }
  }

  return res.json({
    summary: {
      user_id: userId,
      usage_event_count: usageRowsAll.length,
      balance_usd: toDecimalString(balance, 4),
      granted_usd: toDecimalString(grantedUsd, 4),
      recharged_usd: toDecimalString(rechargedUsd, 4),
      used_usd: toDecimalString(usedUsd, 6),
      platform_cost_estimated_usd: toDecimalString(platformCostEstimatedUsd, 6),
      openai_cost_usd: toDecimalString(openaiCostUsd, 6),
      xai_cost_usd: toDecimalString(xaiCostUsd, 6),
      openai_platform_cost_estimated_usd: toDecimalString(openaiPlatformCostEstimatedUsd, 6),
      xai_platform_cost_estimated_usd: toDecimalString(xaiPlatformCostEstimatedUsd, 6)
    },
    recent_usage: recentUsageRows.map((row) => {
      const raw = row.raw && typeof row.raw === "object" ? row.raw : null;
      return {
        usage_event_id: row.id,
        created_at: row.createdAt,
        provider: row.provider,
        operation: row.operation,
        model: row.model,
        unit_type: row.unitType,
        total_units: toDecimalString(row.totalUnits, 6),
        duration_seconds: row.durationSeconds,
        billed_usd: toDecimalString(row.costUsd, 6),
        platform_cost_estimated_usd: toDecimalString(estimatePlatformCostFromUsageEvent(row), 6),
        request_id: row.requestId || null,
        video_url: raw?.output_video_url || null
      };
    })
  });
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastLoginAt: true
    }
  });
  const balances = await Promise.all(
    users.map(async (user) => ({ userId: user.id, balance: await getUserBalance(user.id) }))
  );
  const balanceMap = new Map(balances.map((item) => [item.userId, item.balance]));
  return res.json({
    users: users.map((user) => ({
      ...sanitizeUser(user),
      last_login_at: user.lastLoginAt,
      balance_usd: toDecimalString(balanceMap.get(user.id) || 0, 4),
      balance_credits: toDecimalString(balanceMap.get(user.id) || 0, 4)
    }))
  });
});

app.get("/api/admin/accounts-overview", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      lastLoginAt: true
    }
  });
  const userIds = users.map((user) => user.id);

  const ledgerRows = userIds.length
    ? await prisma.creditLedger.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, type: true, amountCredits: true, createdAt: true }
    })
    : [];

  const usageRows = userIds.length
    ? await prisma.usageEvent.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        provider: true,
        operation: true,
        unitType: true,
        model: true,
        totalUnits: true,
        durationSeconds: true,
        costUsd: true,
        raw: true,
        createdAt: true
      }
    })
    : [];
  const paymentRows = userIds.length
    ? await prisma.payment.findMany({
      where: { userId: { in: userIds }, status: "SUCCEEDED" },
      select: { userId: true, amountUsd: true, createdAt: true }
    })
    : [];

  const balances = await Promise.all(
    users.map(async (user) => ({ userId: user.id, balance: await getUserBalance(user.id) }))
  );
  const balanceMap = new Map(balances.map((item) => [item.userId, item.balance]));

  const grantMap = new Map();
  const usageMap = new Map();
  const paymentMap = new Map();

  for (const row of ledgerRows) {
    const key = row.userId;
    const current = grantMap.get(key) || { grantedUsd: 0, grantEvents: 0, lastGrantAt: null };
    if (row.type === "ADMIN_GRANT") {
      current.grantedUsd += Math.max(0, toNumber(row.amountCredits, 0));
      current.grantEvents += 1;
      if (!current.lastGrantAt || new Date(row.createdAt).getTime() > new Date(current.lastGrantAt).getTime()) {
        current.lastGrantAt = row.createdAt;
      }
    }
    grantMap.set(key, current);
  }

  for (const row of usageRows) {
    const key = row.userId;
    const current = usageMap.get(key) || {
      usedUsd: 0,
      openaiCostUsd: 0,
      xaiCostUsd: 0,
      platformCostUsd: 0,
      openaiPlatformCostUsd: 0,
      xaiPlatformCostUsd: 0,
      videoEvents: 0,
      lastVideoAt: null
    };
    const cost = Math.max(0, toNumber(row.costUsd, 0));
    const platformCost = estimatePlatformCostFromUsageEvent(row);
    current.usedUsd += cost;
    if (row.provider === "OPENAI") current.openaiCostUsd += cost;
    if (row.provider === "XAI") current.xaiCostUsd += cost;
    current.platformCostUsd += platformCost;
    if (row.provider === "OPENAI") current.openaiPlatformCostUsd += platformCost;
    if (row.provider === "XAI") current.xaiPlatformCostUsd += platformCost;
    if (
      row.provider === "XAI" &&
      String(row.operation || "").toLowerCase().startsWith("video.generate") &&
      String(row.unitType || "").toUpperCase() === "SECOND"
    ) {
      current.videoEvents += 1;
      if (!current.lastVideoAt || new Date(row.createdAt).getTime() > new Date(current.lastVideoAt).getTime()) {
        current.lastVideoAt = row.createdAt;
      }
    }
    usageMap.set(key, current);
  }

  for (const payment of paymentRows) {
    const key = payment.userId;
    const current = paymentMap.get(key) || { rechargedUsd: 0, rechargeEvents: 0, lastRechargeAt: null };
    current.rechargedUsd += Math.max(0, toNumber(payment.amountUsd, 0));
    current.rechargeEvents += 1;
    if (!current.lastRechargeAt || new Date(payment.createdAt).getTime() > new Date(current.lastRechargeAt).getTime()) {
      current.lastRechargeAt = payment.createdAt;
    }
    paymentMap.set(key, current);
  }

  const accounts = users.map((user) => {
    const grant = grantMap.get(user.id) || { grantedUsd: 0, grantEvents: 0, lastGrantAt: null };
    const usage = usageMap.get(user.id) || {
      usedUsd: 0,
      openaiCostUsd: 0,
      xaiCostUsd: 0,
      platformCostUsd: 0,
      openaiPlatformCostUsd: 0,
      xaiPlatformCostUsd: 0,
      videoEvents: 0,
      lastVideoAt: null
    };
    const payment = paymentMap.get(user.id) || { rechargedUsd: 0, rechargeEvents: 0, lastRechargeAt: null };
    const remainingUsd = toNumber(balanceMap.get(user.id), 0);
    return {
      user_id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      email_verified: Boolean(user.emailVerifiedAt),
      created_at: user.createdAt,
      last_login_at: user.lastLoginAt,
      granted_usd: toDecimalString(grant.grantedUsd, 4),
      recharged_usd: toDecimalString(payment.rechargedUsd, 4),
      used_usd: toDecimalString(usage.usedUsd, 6),
      platform_cost_estimated_usd: toDecimalString(usage.platformCostUsd, 6),
      remaining_usd: toDecimalString(remainingUsd, 4),
      openai_cost_usd: toDecimalString(usage.openaiCostUsd, 6),
      xai_cost_usd: toDecimalString(usage.xaiCostUsd, 6),
      openai_platform_cost_estimated_usd: toDecimalString(usage.openaiPlatformCostUsd, 6),
      xai_platform_cost_estimated_usd: toDecimalString(usage.xaiPlatformCostUsd, 6),
      video_events: usage.videoEvents,
      last_video_at: usage.lastVideoAt,
      grant_events: grant.grantEvents,
      last_grant_at: grant.lastGrantAt,
      recharge_events: payment.rechargeEvents,
      last_recharge_at: payment.lastRechargeAt
    };
  });

  const totals = accounts.reduce(
    (acc, row) => {
      acc.granted += toNumber(row.granted_usd, 0);
      acc.recharged += toNumber(row.recharged_usd, 0);
      acc.used += toNumber(row.used_usd, 0);
      acc.platformCostEstimated += toNumber(row.platform_cost_estimated_usd, 0);
      acc.remaining += toNumber(row.remaining_usd, 0);
      acc.openai += toNumber(row.openai_cost_usd, 0);
      acc.xai += toNumber(row.xai_cost_usd, 0);
      acc.openaiPlatform += toNumber(row.openai_platform_cost_estimated_usd, 0);
      acc.xaiPlatform += toNumber(row.xai_platform_cost_estimated_usd, 0);
      return acc;
    },
    {
      granted: 0,
      recharged: 0,
      used: 0,
      platformCostEstimated: 0,
      remaining: 0,
      openai: 0,
      xai: 0,
      openaiPlatform: 0,
      xaiPlatform: 0
    }
  );

  return res.json({
    accounts,
    totals: {
      granted_usd: toDecimalString(totals.granted, 4),
      recharged_usd: toDecimalString(totals.recharged, 4),
      used_usd: toDecimalString(totals.used, 6),
      platform_cost_estimated_usd: toDecimalString(totals.platformCostEstimated, 6),
      remaining_usd: toDecimalString(totals.remaining, 4),
      openai_cost_usd: toDecimalString(totals.openai, 6),
      xai_cost_usd: toDecimalString(totals.xai, 6),
      openai_platform_cost_estimated_usd: toDecimalString(totals.openaiPlatform, 6),
      xai_platform_cost_estimated_usd: toDecimalString(totals.xaiPlatform, 6)
    }
  });
});

app.get("/api/admin/videos", requireAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || "200"), 10) || 200));
  const userId = String(req.query.user_id || "").trim();
  const where = {
    provider: "XAI",
    unitType: "SECOND",
    operation: {
      startsWith: "video.generate"
    },
    ...(userId ? { userId } : {})
  };

  const rows = await prisma.usageEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      user: {
        select: { id: true, email: true, username: true }
      }
    }
  });

  return res.json({
    videos: rows.map((row) => {
      const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
      return {
        usage_event_id: row.id,
        request_id: row.requestId || null,
        user_id: row.userId,
        user_email: row.user?.email || null,
        user_username: row.user?.username || null,
        created_at: row.createdAt,
        provider: row.provider,
        operation: row.operation,
        model: row.model,
        duration_seconds: row.durationSeconds,
        cost_usd: toDecimalString(row.costUsd, 6),
        resolution: raw?.resolution || null,
        aspect_ratio: raw?.aspect_ratio || null,
        target_market: raw?.target_market || null,
        final_prompt: raw?.final_prompt || null,
        video_url: raw?.output_video_url || null,
        has_input_image: Boolean(raw?.input_image_data_uri),
        input_image_preview: raw?.input_image_preview || null,
        image_preprocess: raw?.image_preprocess || null,
        pricing_review_required: Boolean(raw?.pricing_review_required),
        pricing_review_message: raw?.pricing_review_message || null
      };
    })
  });
});

app.get("/api/admin/videos/:usageEventId", requireAdmin, async (req, res) => {
  const usageEventId = String(req.params.usageEventId || "").trim();
  if (!usageEventId) return res.status(400).json({ error: "usageEventId is required." });
  const row = await prisma.usageEvent.findUnique({
    where: { id: usageEventId },
    include: { user: { select: { id: true, email: true, username: true } } }
  });
  if (!row) return res.status(404).json({ error: "Video event not found." });
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  let inputImageDataUri = raw?.input_image_data_uri || null;
  let inputImagePreview = raw?.input_image_preview || null;
  let linkedInputImageUsageEventId = null;

  if (!inputImageDataUri) {
    const inputImageWhere = {
      userId: row.userId,
      provider: "XAI",
      operation: "video.generate.input_image",
      ...(row.requestId ? { requestId: row.requestId } : {})
    };
    const inputImageCandidates = await prisma.usageEvent.findMany({
      where: inputImageWhere,
      orderBy: { createdAt: "desc" },
      take: row.requestId ? 8 : 40
    });

    const matchedInputImageEvent =
      inputImageCandidates.find((event) => {
        const eventRaw = event?.raw && typeof event.raw === "object" ? event.raw : null;
        return eventRaw?.linked_video_usage_event_id === row.id && eventRaw?.input_image_data_uri;
      }) ||
      inputImageCandidates.find((event) => {
        const eventRaw = event?.raw && typeof event.raw === "object" ? event.raw : null;
        return Boolean(eventRaw?.input_image_data_uri);
      }) ||
      null;

    if (matchedInputImageEvent) {
      const eventRaw =
        matchedInputImageEvent?.raw && typeof matchedInputImageEvent.raw === "object"
          ? matchedInputImageEvent.raw
          : {};
      inputImageDataUri = eventRaw?.input_image_data_uri || null;
      inputImagePreview = inputImagePreview || eventRaw?.input_image_preview || null;
      linkedInputImageUsageEventId = matchedInputImageEvent.id;
    }
  }

  return res.json({
    video_detail: {
      usage_event_id: row.id,
      request_id: row.requestId || null,
      user_id: row.userId,
      user_email: row.user?.email || null,
      user_username: row.user?.username || null,
      created_at: row.createdAt,
      provider: row.provider,
      operation: row.operation,
      model: row.model,
      duration_seconds: row.durationSeconds,
      cost_usd: toDecimalString(row.costUsd, 6),
      resolution: raw?.resolution || null,
      aspect_ratio: raw?.aspect_ratio || null,
      target_market: raw?.target_market || null,
      final_prompt: raw?.final_prompt || null,
      video_url: raw?.output_video_url || null,
      input_image_data_uri: inputImageDataUri,
      input_image_preview: inputImagePreview,
      linked_input_image_usage_event_id: linkedInputImageUsageEventId,
      image_preprocess: raw?.image_preprocess || null,
      raw
    }
  });
});

app.post("/api/admin/users/:userId/credits/grant", requireAdmin, async (req, res) => {
  const targetUserId = String(req.params.userId || "").trim();
  const amount = toNumber(req.body.amount_usd ?? req.body.amount_credits, 0);
  const reason = String(req.body.reason || "admin usd grant").trim().slice(0, 240);
  if (!targetUserId) return res.status(400).json({ error: "userId is required." });
  if (!(amount > 0)) return res.status(400).json({ error: "amount_usd must be > 0." });

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) return res.status(404).json({ error: "User not found." });

  const result = await appendLedgerEntry({
    userId: targetUserId,
    type: "ADMIN_GRANT",
    amountCredits: amount,
    reason,
    createdByUserId: req.user.id,
    metadata: { adminId: req.user.id, reason }
  });

  await logAudit({
    actorUserId: req.user.id,
    targetUserId,
    action: "admin.usd_grant",
    payload: { amount_usd: amount, reason },
    req
  });

  return res.json({
    status: "ok",
    user_id: targetUserId,
    amount_usd: toDecimalString(amount, 4),
    balance_usd: toDecimalString(result.balanceAfter, 4),
    amount_credits: toDecimalString(amount, 4),
    balance_credits: toDecimalString(result.balanceAfter, 4)
  });
});

app.get("/api/admin/usage", requireAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || "200"), 10) || 200));
  const userId = String(req.query.user_id || "").trim() || undefined;
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const createdAt = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);

  const usageEvents = await prisma.usageEvent.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(from || to ? { createdAt } : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return res.json({
    usage_events: usageEvents.map((event) => ({
      ...event,
      cost_usd: toDecimalString(event.costUsd, 6),
      debit_usd: toDecimalString(event.costUsd, 6),
      credits_deducted: toDecimalString(event.costUsd, 6)
    }))
  });
});

app.get("/api/admin/credits/ledger", requireAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || "200"), 10) || 200));
  const userId = String(req.query.user_id || "").trim() || undefined;
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const createdAt = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);

  const entries = await prisma.creditLedger.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(from || to ? { createdAt } : {})
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return res.json({
    credit_ledger: entries.map((entry) => ({
      ...entry,
      amount_usd: toDecimalString(entry.amountCredits, 4),
      balance_usd: toDecimalString(entry.balanceAfter, 4)
    }))
  });
});

app.get("/api/admin/costs/summary", requireAdmin, async (req, res) => {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const createdAt = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(to);
  const where = from || to ? { createdAt } : {};

  const usageEvents = await prisma.usageEvent.findMany({
    where,
    select: {
      userId: true,
      provider: true,
      costUsd: true,
      createdAt: true
    }
  });

  const providerMap = new Map();
  const userMap = new Map();
  const dayMap = new Map();

  for (const event of usageEvents) {
    const provider = String(event.provider || "UNKNOWN");
    const userId = String(event.userId || "");
    const cost = toNumber(event.costUsd, 0);
    const debitUsd = cost;
    const dayKey = new Date(event.createdAt).toISOString().slice(0, 10);

    const providerRow = providerMap.get(provider) || {
      provider,
      events: 0,
      costUsd: 0,
      debitUsd: 0
    };
    providerRow.events += 1;
    providerRow.costUsd += cost;
    providerRow.debitUsd += debitUsd;
    providerMap.set(provider, providerRow);

    const userRow = userMap.get(userId) || {
      userId,
      events: 0,
      costUsd: 0,
      debitUsd: 0,
      openaiCostUsd: 0,
      xaiCostUsd: 0
    };
    userRow.events += 1;
    userRow.costUsd += cost;
    userRow.debitUsd += debitUsd;
    if (provider === "OPENAI") userRow.openaiCostUsd += cost;
    if (provider === "XAI") userRow.xaiCostUsd += cost;
    userMap.set(userId, userRow);

    const dayRow = dayMap.get(dayKey) || {
      date: dayKey,
      events: 0,
      costUsd: 0,
      debitUsd: 0,
      openaiCostUsd: 0,
      xaiCostUsd: 0
    };
    dayRow.events += 1;
    dayRow.costUsd += cost;
    dayRow.debitUsd += debitUsd;
    if (provider === "OPENAI") dayRow.openaiCostUsd += cost;
    if (provider === "XAI") dayRow.xaiCostUsd += cost;
    dayMap.set(dayKey, dayRow);
  }

  const userIds = [...userMap.keys()].filter(Boolean);
  const users = userIds.length
    ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, username: true }
    })
    : [];
  const userProfileMap = new Map(users.map((user) => [user.id, user]));

  const providerSummary = [...providerMap.values()].sort((a, b) => a.provider.localeCompare(b.provider));
  const userSummary = [...userMap.values()]
    .sort((a, b) => b.costUsd - a.costUsd)
    .map((item) => {
      const profile = userProfileMap.get(item.userId);
      return {
        user_id: item.userId,
        email: profile?.email || null,
        username: profile?.username || null,
        events: item.events,
        cost_usd: toDecimalString(item.costUsd, 6),
        debit_usd: toDecimalString(item.debitUsd, 4),
        credits_deducted: toDecimalString(item.debitUsd, 4),
        openai_cost_usd: toDecimalString(item.openaiCostUsd, 6),
        xai_cost_usd: toDecimalString(item.xaiCostUsd, 6)
      };
    });
  const timeSummary = [...dayMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => ({
      date: item.date,
      events: item.events,
      cost_usd: toDecimalString(item.costUsd, 6),
      debit_usd: toDecimalString(item.debitUsd, 4),
      credits_deducted: toDecimalString(item.debitUsd, 4),
      openai_cost_usd: toDecimalString(item.openaiCostUsd, 6),
      xai_cost_usd: toDecimalString(item.xaiCostUsd, 6)
    }));

  const totalCost = usageEvents.reduce((sum, row) => sum + toNumber(row.costUsd, 0), 0);
  const totalDebitUsd = totalCost;
  return res.json({
    summary: providerSummary.map((row) => ({
      provider: row.provider,
      events: row.events,
      cost_usd: toDecimalString(row.costUsd, 6),
      debit_usd: toDecimalString(row.debitUsd, 4),
      credits_deducted: toDecimalString(row.debitUsd, 4)
    })),
    by_user: userSummary,
    by_day: timeSummary,
    totals: {
      cost_usd: toDecimalString(totalCost, 6),
      debit_usd: toDecimalString(totalDebitUsd, 4),
      credits_deducted: toDecimalString(totalDebitUsd, 4)
    }
  });
});

async function getPricingReviewAlerts(limit = 200) {
  const events = await prisma.usageEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(1000, Number.parseInt(String(limit || "200"), 10) || 200)),
    select: {
      id: true,
      provider: true,
      operation: true,
      model: true,
      raw: true,
      createdAt: true
    }
  });

  const bySignature = new Map();
  for (const event of events) {
    const raw = event?.raw && typeof event.raw === "object" ? event.raw : null;
    const reviewRequired = Boolean(raw?.pricing_review_required);
    if (!reviewRequired) continue;
    const signature = `${event.provider}|${event.operation}|${event.model || ""}|${raw?.pricing_review_message || ""}`;
    const existing = bySignature.get(signature) || {
      provider: event.provider,
      operation: event.operation,
      model: event.model || null,
      message: raw?.pricing_review_message || "Pricing review required.",
      events: 0,
      latest_at: event.createdAt
    };
    existing.events += 1;
    if (!existing.latest_at || new Date(event.createdAt).getTime() > new Date(existing.latest_at).getTime()) {
      existing.latest_at = event.createdAt;
    }
    bySignature.set(signature, existing);
  }

  return [...bySignature.values()]
    .sort((a, b) => new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime())
    .slice(0, 100);
}

app.get("/api/admin/pricing", requireAdmin, async (_req, res) => {
  const pricing = await prisma.pricingSnapshot.findMany({
    orderBy: [{ provider: "asc" }, { operation: "asc" }, { effectiveFrom: "desc" }]
  });
  const reviewAlerts = await getPricingReviewAlerts(300);
  return res.json({
    pricing_snapshots: pricing.map((item) => ({
      ...item,
      balance_usd_per_usd: toDecimalString(BALANCE_USD_PER_USD, 4),
      credits_per_usd: toDecimalString(BALANCE_USD_PER_USD, 4)
    })),
    default_pricing: getDefaultPricingCatalogForConsole(),
    pricing_review_alerts: reviewAlerts
  });
});

app.post("/api/admin/pricing", requireAdmin, async (req, res) => {
  const provider = String(req.body.provider || "").trim().toUpperCase();
  const operation = String(req.body.operation || "").trim();
  const model = String(req.body.model || "").trim() || null;
  const unitType = String(req.body.unit_type || "").trim().toUpperCase();
  const priceUsdPerUnit = toNumber(req.body.price_usd_per_unit, -1);
  const balanceUsdPerUsd = BALANCE_USD_PER_USD;

  if (!["OPENAI", "XAI"].includes(provider)) return res.status(400).json({ error: "Invalid provider." });
  if (!operation) return res.status(400).json({ error: "operation is required." });
  if (!["TOKENS_1K", "REQUEST", "IMAGE", "SECOND"].includes(unitType)) {
    return res.status(400).json({ error: "Invalid unit_type." });
  }
  if (!(priceUsdPerUnit >= 0)) return res.status(400).json({ error: "price_usd_per_unit must be >= 0." });

  const created = await prisma.pricingSnapshot.create({
    data: {
      provider,
      operation,
      model,
      unitType,
      priceUsdPerUnit: toDecimalString(priceUsdPerUnit, 8),
      creditsPerUsd: toDecimalString(balanceUsdPerUsd, 4),
      createdByUserId: req.user.id
    }
  });

  await logAudit({
    actorUserId: req.user.id,
    action: "admin.pricing_create",
    payload: {
      provider,
      operation,
      model,
      unit_type: unitType,
      price_usd_per_unit: priceUsdPerUnit,
      balance_usd_per_usd: balanceUsdPerUsd,
      credits_per_usd: balanceUsdPerUsd
    },
    req
  });

  return res.status(201).json({ pricing_snapshot: created });
});

app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit || "100"), 10) || 100));
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return res.json({ audit_logs: logs });
});

app.post("/api/auto-prompt", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;
  const count = normalizeVideoCount(req.body.count);
  const duration = normalizeDuration(req.body.duration) || 4;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
  }
  if (!image) {
    return res.status(400).json({ error: "image is required." });
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

app.post("/api/generate-scene-video-prompt", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;
  const duration = normalizeDuration(req.body.duration) || 4;
  const targetMarket = normalizeTargetMarket(req.body.target_market);
  let scene = null;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
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
      duration,
      targetMarket
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

app.post("/api/regenerate-scene", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;
  const duration = normalizeDuration(req.body.duration) || 4;
  const index = Number.parseInt(String(req.body.index || ""), 10);
  const total = normalizeVideoCount(req.body.total);
  let existingDirections = [];

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
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

app.post("/api/process-product-image", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
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

  const normalizedAspectRatio = String(aspectRatio || "").trim().toLowerCase();
  let finalDataUri = coerced.dataUri;
  let finalMime = detectMimeFromDataUri(finalDataUri);
  let cropMeta = null;
  if (normalizedAspectRatio && normalizedAspectRatio !== "auto" && parseAspectRatio(normalizedAspectRatio)) {
    const decoded = decodeDataUri(coerced.dataUri);
    if (!decoded?.buffer) {
      const err = new Error("Failed to decode generated first-frame image for aspect-ratio crop.");
      err.openaiStatus = 502;
      err.openaiRaw = editCall.data;
      err.debug = { request: requestPreview, response: responsePreview };
      throw err;
    }

    const cropResult = await cropImageBufferToAspectRatio({
      imageBuffer: decoded.buffer,
      aspectRatio: normalizedAspectRatio
    });
    finalDataUri = encodeDataUri(cropResult.buffer, cropResult.mime);
    finalMime = cropResult.mime;
    cropMeta = cropResult.meta || null;
  }

  return {
    dataUri: finalDataUri,
    mime: finalMime,
    prompt,
    debug: {
      request: requestPreview,
      response: {
        ...responsePreview,
        aspect_ratio_crop: cropMeta || { applied: false }
      }
    }
  };
}

app.post("/api/generate-first-frames", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;
  const aspectRatio = String(req.body.aspect_ratio || "auto").trim();

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
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

app.post("/api/generate-first-frame", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const openaiApiKey = resolveOpenAiApiKey(req.body.openai_api_key);
  const image = req.file;
  const aspectRatio = String(req.body.aspect_ratio || "auto").trim();
  const sceneDirection = String(req.body.scene_direction || "").trim();
  const videoPrompt = String(req.body.prompt || "").trim();
  const index = Number.parseInt(String(req.body.index || ""), 10);
  const total = Number.parseInt(String(req.body.total || ""), 10);

  if (!openaiApiKey) {
    return res.status(400).json({ error: "OpenAI API key is not configured." });
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

app.post("/api/generate-video", requireAuth, requirePositiveCredits, requireVerifiedEmail, upload.single("image"), async (req, res) => {
  const apiKey = resolveXaiApiKey(req.body.api_key);
  if (!apiKey) {
    return res.status(400).json({ error: "XAI API key is not configured." });
  }

  const prompt = String(req.body.prompt || "").trim();
  const targetMarket = normalizeTargetMarket(req.body.target_market);
  const finalPrompt = `${buildVideoPromptAppend(targetMarket)}\n\n${prompt}`.trim();
  const duration = normalizeDuration(req.body.duration);
  const resolution = String(req.body.resolution || "480p").trim();
  const hasReferenceImage = Boolean(req.file);
  const requestedAspectRatio = String(req.body.aspect_ratio || "auto").trim().toLowerCase();
  let effectiveAspectRatio = null;
  let billingEstimate = null;

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

  if (req.user?.id) {
    const videoComponent = await estimateCreditsForUsage({
      provider: "XAI",
      operation: getXaiVideoPricingOperation(resolution),
      model: XAI_VIDEO_MODEL,
      unitType: "SECOND",
      totalUnits: duration,
      durationSeconds: duration
    });
    const imageInputComponent = hasReferenceImage
      ? await estimateCreditsForUsage({
        provider: "XAI",
        operation: "video.generate.input_image",
        model: XAI_VIDEO_MODEL,
        unitType: "IMAGE",
        totalUnits: 1
      })
      : null;

    const totalDebitUsd =
      toNumber(videoComponent?.debitUsd, 0) +
      toNumber(imageInputComponent?.debitUsd, 0);
    const totalCostUsd =
      toNumber(videoComponent?.costUsd, 0) +
      toNumber(imageInputComponent?.costUsd, 0);

    billingEstimate = {
      totalDebitUsd,
      totalCostUsd,
      components: {
        video_seconds: videoComponent || null,
        input_image: imageInputComponent || null
      },
      pricing_source: [videoComponent?.pricing_source, imageInputComponent?.pricing_source].filter(Boolean).join("+") || null,
      pricing_review_required: Boolean(
        videoComponent?.pricing_review_required || imageInputComponent?.pricing_review_required
      ),
      pricing_review_message:
        [videoComponent?.pricing_review_message, imageInputComponent?.pricing_review_message]
          .filter(Boolean)
          .join(" | ") || null
    };

    if (totalDebitUsd > 0) {
      const balance = await getUserBalance(req.user.id);
      if (balance < totalDebitUsd) {
        return res.status(402).json({
          error: "Insufficient USD balance for this video generation request.",
          required_usd: toDecimalString(totalDebitUsd, 4),
          balance_usd: toDecimalString(balance, 4),
          required_credits: toDecimalString(totalDebitUsd, 4),
          balance_credits: toDecimalString(balance, 4),
          billing_breakdown: {
            video_seconds_usd: toDecimalString(toNumber(videoComponent?.debitUsd, 0), 6),
            input_image_usd: toDecimalString(toNumber(imageInputComponent?.debitUsd, 0), 6)
          }
        });
      }
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xai-input-"));
  let imagePath = null;
  let imagePreprocess = { padded: false };
  let requestPreview = null;
  let usageEventId = null;
  let inputImageUsageEventId = null;

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
        target_market: targetMarket,
        duration: sdkPayload.duration,
        resolution: sdkPayload.resolution,
        aspect_ratio: sdkPayload.aspect_ratio || "follow-input-image",
        estimated_debit_usd: billingEstimate ? toDecimalString(billingEstimate.totalDebitUsd, 6) : null,
        estimated_cost_usd: billingEstimate ? toDecimalString(billingEstimate.totalCostUsd, 6) : null,
        estimated_debit_breakdown: billingEstimate
          ? {
            video_seconds_usd: toDecimalString(
              toNumber(billingEstimate?.components?.video_seconds?.debitUsd, 0),
              6
            ),
            input_image_usd: toDecimalString(
              toNumber(billingEstimate?.components?.input_image?.debitUsd, 0),
              6
            )
          }
          : null,
        billing_pricing_source: billingEstimate?.pricing_source || null,
        billing_pricing_review_required: billingEstimate?.pricing_review_required || false,
        billing_pricing_review_message: billingEstimate?.pricing_review_message || null,
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

    if (req.user?.id) {
      const persistedImageDataUri = toDataUriWithLimit(req.file, 3_000_000);
      try {
        const usageEvent = await recordUsageEventAndDebit({
          userId: req.user.id,
          provider: "XAI",
          operation: getXaiVideoPricingOperation(sdkPayload.resolution),
          model: sdkPayload.model || XAI_VIDEO_MODEL,
          unitType: "SECOND",
          totalUnits: toNumber(sdkPayload.duration, 0),
          durationSeconds: normalizeDuration(sdkPayload.duration) || null,
          requestId: sdkResult?.request_id || null,
          raw: {
            route: "/api/generate-video",
            target_market: targetMarket,
            resolution: sdkPayload.resolution,
            aspect_ratio: sdkPayload.aspect_ratio || "follow-input-image",
            duration_seconds: sdkPayload.duration,
            final_prompt: toPreviewText(finalPrompt, 5000),
            output_video_url: videoUrl,
            image_preprocess: imagePreprocess || null,
            input_image_preview: summarizeUploadedFile(req.file),
            input_image_data_uri: persistedImageDataUri,
            input_image_persisted: Boolean(persistedImageDataUri)
          }
        });
        usageEventId = usageEvent?.id || null;
        if (hasReferenceImage) {
          const inputImageUsageEvent = await recordUsageEventAndDebit({
            userId: req.user.id,
            provider: "XAI",
            operation: "video.generate.input_image",
            model: sdkPayload.model || XAI_VIDEO_MODEL,
            unitType: "IMAGE",
            totalUnits: 1,
            requestId: sdkResult?.request_id || null,
            raw: {
              route: "/api/generate-video",
              target_market: targetMarket,
              resolution: sdkPayload.resolution,
              aspect_ratio: sdkPayload.aspect_ratio || "follow-input-image",
              linked_video_usage_event_id: usageEventId,
              input_image_preview: summarizeUploadedFile(req.file),
              input_image_data_uri: persistedImageDataUri,
              input_image_persisted: Boolean(persistedImageDataUri)
            }
          });
          inputImageUsageEventId = inputImageUsageEvent?.id || null;
        }
      } catch (billingError) {
        console.error("usage_meter_video_error", billingError.message);
      }
    }

    return res.json({
      status: "done",
      video_url: videoUrl,
      usage_event_id: usageEventId,
      input_image_usage_event_id: inputImageUsageEventId,
      final_prompt: finalPrompt,
      target_market: targetMarket,
      estimated_debit_usd: billingEstimate ? toDecimalString(billingEstimate.totalDebitUsd, 6) : null,
      estimated_cost_usd: billingEstimate ? toDecimalString(billingEstimate.totalCostUsd, 6) : null,
      estimated_debit_breakdown: billingEstimate
        ? {
          video_seconds_usd: toDecimalString(toNumber(billingEstimate?.components?.video_seconds?.debitUsd, 0), 6),
          input_image_usd: toDecimalString(toNumber(billingEstimate?.components?.input_image?.debitUsd, 0), 6)
        }
        : null,
      billing_pricing_source: billingEstimate?.pricing_source || null,
      billing_pricing_review_required: billingEstimate?.pricing_review_required || false,
      billing_pricing_review_message: billingEstimate?.pricing_review_message || null,
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

app.use("/api", (_req, res) => {
  return res.status(404).json({ error: "API route not found." });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
