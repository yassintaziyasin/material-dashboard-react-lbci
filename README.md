# Catalyst Operations Console (Zoho Catalyst Slate Edition)

Full-stack **Next.js (SSR + API Route Handlers)** port of the Zoho Catalyst automation console, built to run natively on **Zoho Catalyst Slate** (`*.onslate.com`) with **zero external database configuration**.

## Features
- **Bulk Email Dispatch** — Concurrent dispatch (`1–25` parallel workers), adaptive inter-request delay, HTML preview modal (Desktop/Mobile), merge tags (`{{name}}`, `{{email}}`), `.txt`/`.csv` import, deduplication, auto-pause on consecutive errors, and 1-click failed batch retry.
- **Bulk User Provisioning** — Register Catalyst project users (`platform_type: "web"`) from plain email lists or `email,FirstName,LastName` CSV files.
- **User Directory & Cleanup** — Paginated user listing with **64-bit integer safe ID parsing**, instant search filter, single-user delete, and multi-select bulk deletion.
- **Zero-DB Multi-Profile Management** — Profiles persist in browser `localStorage` with 1-click **Backup / Import JSON** (compatible with Cloudflare D1 exports) + stateless server-side OAuth popup flow (`/api/zoho/auth` & `/api/zoho/callback`) supporting all Zoho Data Centers (`.com`, `.eu`, `.in`, `.com.au`, `.jp`, `.ca`, `.uk`).

## Deploying to Zoho Catalyst Slate

1. **Push to GitHub:**
   ```bash
   git add .
   git commit -m "Port Catalyst Operations Console to Next.js for Catalyst Slate"
   git push origin main
   ```

2. **Verify Slate Framework Configuration:**
   Since the starter repo originally used Create React App (`build/`), open your **Catalyst Console → Slate → Your App → Configuration → Frameworks & Build Command** and verify:
   - **Framework:** `Next.js`
   - **Install Command:** `npm install`
   - **Build Command:** `npm run build`
   - **Build Path:** `.next`

3. **Zoho OAuth Redirect URI:**
   In [Zoho API Console](https://api-console.zoho.com/) (Server-based Application), add your Slate callback URL:
   ```text
   https://<your-app-domain>.onslate.com/api/zoho/callback
   ```

## Local Development
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.
