# Humanize - Grok

AI video generation web app (Node + Python xAI SDK) with account system, USD balance ledger, and admin analytics.

## Current workflow

- Login with email/password or Google OAuth.
- Verified users generate scene directions, first-frame images, and videos.
- All model calls record `usage_events` and deduct USD balance from immutable `credit_ledger`.
- Admin can grant USD balance, inspect usage/costs, and manage pricing snapshots.

## Local run

1. Install dependencies and Python tools:

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Prepare database and Prisma client:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

4. Start:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy (Render, no custom domain needed)

1. Push code to GitHub.
2. Create Render Web Service using `Docker` runtime.
3. Add env vars (minimum):
- `DATABASE_URL`
- `SESSION_SECRET`
- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `APP_BASE_URL`
- `PORT=3000`
4. Optional:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `ADMIN_EMAILS` (comma separated)
- `DEFAULT_PRICE_OPENAI_CHAT_INPUT_TOKENS_1K`
- `DEFAULT_PRICE_OPENAI_CHAT_OUTPUT_TOKENS_1K`
- `DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1024`
- `DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1024x1536`
- `DEFAULT_PRICE_OPENAI_IMAGE_EDITS_1536x1024`
- `DEFAULT_PRICE_XAI_VIDEO_480P_PER_SECOND`
- `DEFAULT_PRICE_XAI_VIDEO_720P_PER_SECOND`
- `DEFAULT_PRICE_XAI_VIDEO_INPUT_IMAGE`
4. Deploy and use the generated `*.onrender.com` URL.

## Notes

- API keys are server-managed only (`OPENAI_API_KEY` / `XAI_API_KEY`). End users do not input keys in UI.
- If either server key is missing, Step 1 blocks progress and shows configuration status.
- `SKIP_EMAIL_VERIFICATION=true` is enabled by default in non-production for faster local testing; USD balance checks still apply.
- Pillow handles cross-platform image padding before video generation.
- Server prefers `./.venv/bin/python3` automatically (or set `PYTHON_BIN` to override).
- `/api/process-product-image` is kept as an optional legacy utility; the active scene pipeline does not use it.
- Admin analytics APIs: `/api/admin/users`, `/api/admin/usage`, `/api/admin/credits/ledger`, `/api/admin/costs/summary`.
- Admin pricing console now shows default model-mapped unit prices + pricing review alerts for unknown/new model-interface calls.
