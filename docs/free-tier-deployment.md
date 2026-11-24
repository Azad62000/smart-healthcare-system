# Free-tier deployment

This runbook deploys the existing Next.js app to Vercel, the Express API to a free Render web service, PostgreSQL to Neon, and encrypted appointment documents to Cloudflare R2. Repository inspection found no Render or Vercel deployment manifest. `render-free.yaml` is a separate Blueprint; selecting it creates only the listed free API service and does not change any Dashboard-managed Render service. It uses a fresh Neon database and synthetic accounts only. It does not move or seed local patient records.

Free plans are suitable for a disposable demo, not clinical use. Keep every record synthetic and do not upload real patient documents.

## Before you start

- Push the deployment changes to the Git repository connected to Vercel and Render.
- Use a fresh Neon project for the demo. Do not point this setup at a database containing existing patient data.
- Create a Vercel project on the Hobby plan only for personal, non-commercial use. Vercel states that Hobby is for personal use; commercial use requires a different plan.
- Keep the API and web URLs handy. Vercel and Render default domains are on different sites, so this configuration uses secure `SameSite=None` cookies. Some browsers block third-party cookies; if sign-in does not persist, use app and API subdomains under the same registrable domain and set `SESSION_COOKIE_SAME_SITE=lax`.

## 1. Neon database

1. In Neon, create a **Free** project and database for this demo.
2. Open **Connect**, choose the database and role, enable the pooled connection option, and copy the pooled connection string. It must be a PostgreSQL URL with TLS required (`sslmode=require`). Keep it private.
3. Do not import local data or run the development demo seed. The migration runner will create the schema without inserting user records.

Neon's current Free plan includes 100 CU-hours per project per month, 1 GB of database storage per project, and 5 GB of public transfer per project. Compute scales to zero after five idle minutes; reaching a compute or transfer quota suspends compute until the quota resets. [Neon Free plan limits](https://neon.com/docs/introduction/free-tier)

## 2. Cloudflare R2

1. In Cloudflare, open **Storage & databases → R2 → Overview** and complete the R2 subscription checkout, then create a bucket with the **Standard** storage class. Keep the bucket private; do not enable public access or `r2.dev`.
2. Create an R2 API token limited to **Object Read & Write** for this bucket only.
3. Copy the Account ID, bucket name, Access Key ID, and Secret Access Key into the Render environment variables below. Do not put them in Git, Vercel, or a client-side variable.
4. Keep the medical encryption key separately backed up. R2 stores ciphertext from the app's existing AES-256-GCM encryption; it does not replace that key.

R2's current monthly free allowance is 10 GB-month of Standard storage, 1 million Class A operations, and 10 million Class B operations; egress is free. Cloudflare requires an R2 subscription checkout and bills usage beyond the allowance. This app does not enforce a Cloudflare spend cap, so review the account's billing and overage behavior before completing checkout. If strict zero-charge operation is required, do not activate R2 until you have a verified hard billing limit. [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [R2 subscription setup](https://developers.cloudflare.com/r2/get-started/) · [R2 S3 credentials and endpoint](https://developers.cloudflare.com/r2/get-started/s3/)

## 3. Vercel frontend

1. Import the Git repository as a new Vercel project.
2. Set **Root Directory** to `apps/web`, keep the **Next.js** framework preset, and select Node.js **24.x** under **Settings → Build and Deployment**. The app's `vercel.json` runs `npm ci --include=dev` so TypeScript and other build-time dev dependencies are installed from the repository lockfile; keep the detected Next.js build command.
3. Add `NEXT_PUBLIC_API_URL` for Production. For the first build, use an HTTPS placeholder such as `https://api.example.invalid`; the app only checks that the production API URL is HTTPS while building. Replace it with the real Render API URL and redeploy after Render is live.
4. Deploy once and copy the resulting production origin, for example `https://your-project.vercel.app`. Do not add API credentials to Vercel.
5. Turn off preview deployments for this demo or leave them unused. The API's CORS allowlist is one exact `WEB_ORIGIN`, so preview domains are not allowed automatically.

Vercel's Hobby plan is free for personal use. Usage limits can pause some features until their reset window; Hobby is not a commercial-use plan. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

## 4. Render API

1. Confirm the Render workspace has no payment method attached if you require a hard $0 limit: Render bills free services for outbound bandwidth or build pipeline overages when a payment method is on file. Without one, those quotas suspend services or pause new builds instead. In the Render Dashboard, create a Blueprint from this repository and select `render-free.yaml` as the Blueprint file. This file explicitly sets the API to `plan: free`; it does not create a database or change any paid Render service.
2. In the Blueprint prompt, supply the values below. Select **Free** if the dashboard asks for a compute plan; do not upgrade the service.
3. For the first API deploy, set `WEB_ORIGIN` to the exact Vercel production origin from step 3. Keep `SESSION_COOKIE_SAME_SITE=none` for the default Vercel and Render domains.
4. Wait for the service to become live, then copy its HTTPS `onrender.com` URL.
5. In Vercel, replace `NEXT_PUBLIC_API_URL` with that Render API origin (no trailing slash) and redeploy.
6. In Render, confirm `WEB_ORIGIN` still exactly matches the production Vercel origin, then redeploy if it changed.

### Render environment variables

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.22.1` (pinned in `render-free.yaml`; current dependencies require Node 24) |
| `API_HOST` | `0.0.0.0` |
| `PORT` | Set by Render; leave it unset in the dashboard. The API reads Render's `PORT`. |
| `WEB_ORIGIN` | Exact Vercel production origin, such as `https://your-project.vercel.app`, no trailing slash |
| `DATABASE_URL` | Neon pooled PostgreSQL URL with TLS required |
| `SESSION_COOKIE_SECURE` | `true` |
| `SESSION_COOKIE_SAME_SITE` | `none` for the default `.vercel.app` and `.onrender.com` domains; use `lax` when both services use subdomains under the same site |
| `SESSION_TTL_HOURS` | `12` (or your chosen session lifetime) |
| `MEDICAL_DATA_ENCRYPTION_KEYS` | A unique 32-byte keyring entry, formatted `demo-v1:<64-hex-characters>` |
| `ADMIN_MFA_ENCRYPTION_KEY` | A separate 32-byte hex key |
| `AUTH_OTP_PEPPER` | A third, separate 32-byte hex key |
| `SMTP_HOST` | SMTP hostname from your mail provider |
| `SMTP_PORT` | `2525` only when supported by your mail provider |
| `SMTP_SECURE` | `false` for STARTTLS on port 2525 |
| `SMTP_USER` / `SMTP_PASSWORD` | Optional; set both together if required by your provider |
| `SMTP_FROM` | Verified sender email address |
| `SMTP_FROM_NAME` | `Smart Healthcare Demo` |
| `DOCUMENT_STORAGE_DRIVER` | `r2` |
| `DOCUMENT_MAX_BYTES` | `10000000` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_BUCKET_NAME` | Private bucket name |
| `R2_ACCESS_KEY_ID` | Bucket-scoped R2 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Bucket-scoped R2 Secret Access Key |

Generate the three independent encryption/pepper secrets in a trusted local terminal with `openssl rand -hex 32`. For the medical keyring, prefix one generated output with a key ID, for example `demo-v1:`. Store the original key values in a protected password manager or equivalent offline backup. Losing an encryption key makes stored encrypted content unreadable.

Render sets `RENDER_EXTERNAL_URL`; the API uses it as `API_PUBLIC_URL` when that variable is not explicitly set. If you add a custom API domain, set `API_PUBLIC_URL` to that exact HTTPS domain. Register OAuth callbacks as `${API_PUBLIC_URL}/api/v1/auth/oauth/google/callback` and/or `${API_PUBLIC_URL}/api/v1/auth/oauth/facebook/callback`.

The app requires SMTP configuration in production because email verification and recovery codes use email. Render blocks outbound ports 25, 465, and 587 on Free services. Use an SMTP provider that supports port 2525, or these flows will fail. Confirm that provider's free allowance before configuring it; no email service is provisioned by this repo. [Render Free service limits](https://render.com/docs/free)

Optional server-side variables can enable existing features: `GEMINI_API_KEY` and `GEMINI_MODEL`; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`; `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`; `ABDM_DRUG_REGISTRY_API_KEY`; `DOCTOR_RECOMMENDATIONS_ENABLED`; `QDIABETES_SERVICE_URL`; `SYMPTOM_CLASSIFIER_SERVICE_URL`; and `FRACATLAS_SERVICE_URL`. Keep provider secrets on Render only.

## 5. Apply migrations

Migrations are not run during API startup. From the checked-out repository, run the existing migration runner against the new Neon database. Supply the pooled URL through the shell so it overrides the local `.env` value:

```sh
read -rs DATABASE_URL
export DATABASE_URL
npm run db:migrate -w @healthcare/api
unset DATABASE_URL
```

Paste the Neon URL at the hidden prompt and press Enter. Confirm the command applies the contiguous migrations through `030_gemini_patient_chat.sql`. It prints one `Applied ...` line per migration. Never run the baseline command on a fresh database, and never run `demo:seed` against Neon; that command is deliberately restricted to the local development database.

After migrations, verify the database readiness endpoint before creating accounts:

```sh
curl --fail --show-error https://<render-api-host>/health/ready
```

## 6. Synthetic accounts and first Admin

Use synthetic names, dates, notes, and documents only. Create a synthetic Patient through the deployed sign-up page and complete email verification. For the first Admin on this new, empty demo database, promote only that verified test account in the Neon SQL editor:

```sql
UPDATE users
SET role = 'Admin', updated_at = now()
WHERE email = '<verified-synthetic-admin-email>'
  AND role = 'Patient'
  AND status = 'active'
  AND email_verified = true;
```

Check that exactly one row was updated. Sign in again, complete the required Admin authenticator enrollment, and securely save the recovery codes. Do not use public local-demo credentials. Create a second verified synthetic account, then promote it only if it is still a Patient:

```sql
UPDATE users
SET role = 'Doctor', updated_at = now()
WHERE email = '<verified-synthetic-doctor-email>'
  AND role = 'Patient'
  AND status = 'active'
  AND email_verified = true;
```

Check that exactly one row was updated. Sign in as the Doctor, complete a synthetic profile, then approve it from the Admin UI. Register a separate synthetic Patient and make a future appointment to exercise document uploads.

## 7. Verify deployment and integrations

Run the built-in public smoke checks after setting the deployed URLs. This checks the web page, API liveness, database connection, a database-backed doctor-directory read, and credentialed CORS:

```sh
API_PUBLIC_URL='https://<render-api-host>' \
WEB_PUBLIC_URL='https://<vercel-project>.vercel.app' \
WEB_ORIGIN='https://<vercel-project>.vercel.app' \
npm run deploy:smoke -w @healthcare/api
```

For an authenticated check, use a synthetic Patient account and a future appointment belonging to it. The script signs in, checks the session, uploads a synthetic PDF, downloads and byte-compares it (exercising API authorization, Neon metadata, R2 upload, encryption/decryption), then removes the object and soft-deletes its synthetic metadata:

```sh
read -r SMOKE_PATIENT_EMAIL
read -rs SMOKE_PATIENT_PASSWORD
export SMOKE_PATIENT_EMAIL SMOKE_PATIENT_PASSWORD
SMOKE_DATA_IS_SYNTHETIC=true \
SMOKE_APPOINTMENT_ID='<future-appointment-uuid>' \
API_PUBLIC_URL='https://<render-api-host>' \
WEB_PUBLIC_URL='https://<vercel-project>.vercel.app' \
WEB_ORIGIN='https://<vercel-project>.vercel.app' \
npm run deploy:smoke -w @healthcare/api
unset SMOKE_PATIENT_EMAIL SMOKE_PATIENT_PASSWORD
```

Also sign in from a browser at the Vercel production URL and confirm that the session remains active after navigation. If the browser blocks third-party cookies, attach same-site custom domains to Vercel and Render if you already have a domain, set `WEB_ORIGIN` and `API_PUBLIC_URL` to those domains, change `SESSION_COOKIE_SAME_SITE` to `lax`, and redeploy.

These checks are not a deployment claim until they have been run against the actual URLs and pass. Share the public Vercel and Render URLs after setup if you want the live endpoints checked from here. Never send credentials, database URLs, or R2 secrets in chat.

## Free-tier limits and unavailable workloads

- Render Free web services sleep after 15 minutes idle, can take about a minute to wake, have ephemeral filesystems, and share 750 free instance-hours per workspace per month. Outbound traffic and build minutes have quotas; overages can suspend services if no payment method is attached or be billable otherwise. Use R2 for documents; local disk is not persistent. [Render Free limits](https://render.com/docs/free)
- Neon Free compute suspends at its monthly quota, storage is limited to 1 GB per project, and free restore history is limited. Do not use it as the only copy of important data. [Neon Free plan limits](https://neon.com/docs/introduction/free-tier)
- R2's allowance is finite. Monitor usage to prevent any metered overage. Only Standard storage has the free allowance. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- Vercel Hobby usage may pause at plan limits and is for personal projects; it is unsuitable if this demo is operated commercially. [Vercel Hobby](https://vercel.com/docs/plans/hobby)
- QDiabetes is the light optional FastAPI service and has a separate free Render config, `render-qdiabetes-free.yaml`. It uses another free instance and consumes the same workspace free-instance hours. Deploy it only if needed, then set `QDIABETES_SERVICE_URL` on the API to its public HTTPS URL. Its output warns that the model is designed for UK populations and is not validated for Indian patients.
- FracAtlas uses Ultralytics/PyTorch model weights and CPU inference; the symptom classifier pins `tensorflow-macos` and downloads a Transformers model. These workloads are not a reliable fit for Render's 512 MB / 0.1 CPU Free web service, and the symptom classifier's dependency is macOS-specific. Leave them disabled for this free deployment. They require a compatible, larger paid compute or a separately managed inference host.
- LiveKit video requires a separately configured provider. Gemini calls send prompts and optional files to Google's API and have separate provider limits and data handling. Do not submit real patient data to either service.
