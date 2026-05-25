# Support Tickets Dashboard — Deployment Guide

> **Audience:** Teammates deploying or maintaining the CSOP Jira dashboard on Unity Tessen.  
> **Last updated:** May 2026 · **Environment documented:** Tessen **test**

---

## At a glance

| | |
|---|---|
| **Live dashboard (test)** | https://support-tickets-dashboard.test.app.tessen.unity.com |
| **GitHub** | https://github.com/rohinimohan-create/support-tickets-dashboard |
| **Tessen namespace** | `csops-ops-csops-tickets-test-dashboard` |
| **Tessen team** | `csops-ops` |
| **Support** | Slack `#devs-tessen` |

---

## Table of contents

- [What this project is](#what-this-project-is)
- [How deployment works](#how-deployment-works)
- [Before you start](#before-you-start)
- [Naming reference](#naming-reference)
- [First-time setup](#first-time-setup)
- [Jira authentication](#jira-authentication)
- [Deploy to test (step by step)](#deploy-to-test-step-by-step)
- [GitHub](#github)
- [CI/CD with GitHub Actions](#cicd-with-github-actions)
- [Commands cheat sheet](#commands-cheat-sheet)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Official Tessen links](#official-tessen-links)

---

## What this project is

### Application

- **Stack:** Node.js, Express, EJS (`server.js`, `views/index.ejs`)
- **Data:** Jira REST API — CSOP project metrics, charts, open issues
- **Port:** `8080` inside the container

### Platform

- **Docker** image → Unity Artifact Registry  
- **Tessen** reads `docker-compose.yml` and deploys to shared GKE (**test** / **stg** / **prd**)
- You do **not** manage Kubernetes YAML for normal deploys

### Important rule

> **Local `.env` is not used in the cluster.**  
> The running pod gets config from **Tessen namespace secrets** and deploy flags (`-E`).  
> After changing `.env`, you must run `tessen namespace secrets add` and **redeploy**.

---

## How deployment works

### Flow

```
Your laptop or GitHub Actions
        │
        ├─► docker build + docker push
        │       └── europe-docker.pkg.dev/.../support-tickets-dashboard:<tag>
        │
        └─► tessen deployment up
                └── Tessen → GKE (ingress, TLS, secrets, pods)
```

### Two scripts (repo root)

| Script | Purpose |
|--------|---------|
| `scripts/build-and-push.sh` | Build `linux/amd64` image and **push** to registry |
| `scripts/tessen-deploy.sh` | Run `tessen deployment up` + `status` |

> **Common mistake:** Running deploy without push → `ImagePullBackOff` because `:local` (or your tag) does not exist in the registry.

---

## Before you start

### Tools

| Tool | How to get it |
|------|----------------|
| Tessen CLI | `brew install --cask tessen` |
| Docker Desktop | Running; `docker ps` works |
| Git | Clone / push to GitHub |
| VPN | Unity network (Jira + internal URLs) |

### Access

| Requirement | Detail |
|-------------|--------|
| Tessen login | `tessen auth login` |
| Team | **`csops-ops`** |
| Jira | Personal Access Token (PAT) for `https://jira.unity3d.com` |

### Not required

- Local **npm** — dependencies install inside `docker build`
- Kubernetes expertise — for routine deploys

---

## Naming reference

Use these names consistently in commands, compose, and registry paths.

| Concept | Value |
|---------|--------|
| Tessen team | `csops-ops` |
| Project slug (from `tessen init`) | `csops-tickets-test-dashboard` |
| **Namespace** | `csops-ops-csops-tickets-test-dashboard` |
| Compose service name | `support-tickets-dashboard` |
| Image repository | `europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard` |
| Local / manual tag | `local` (when not using CI) |
| Test URL hostname | `support-tickets-dashboard.test.app.tessen.unity.com` |

Defaults are in **`.tessen.yml`** (namespace, cluster).

---

## First-time setup

### Clone the repository

```bash
git clone https://github.com/rohinimohan-create/support-tickets-dashboard.git
cd support-tickets-dashboard
```

### Local config (development only)

```bash
cp .env.example .env
```

Edit `.env` — **never commit this file.**

```env
PORT=8080
JIRA_BASE_URL=https://jira.unity3d.com
PROJECT_KEY=CSOP
AUTH_MODE=bearer
JIRA_API_TOKEN=<your-jira-pat>
```

### Docker registry authentication

```bash
tessen docker config
```

- Confirm `europe-docker.pkg.dev` uses the **tessen** credential helper.
- If prompted in the terminal UI, choose **Continue**.

### New project from scratch (optional)

If the repo did not already include Tessen files:

```bash
tessen init
```

That creates `.tessen.yml`, `docker-compose.yml`, Dockerfile, scripts, and GitHub workflows.

---

## Jira authentication

### Unity Jira does not use Basic auth

If you deploy with `AUTH_MODE=basic`, Jira returns:

```json
{"message":"Basic Authentication has been disabled on this instance."}
```

### Correct setup: Bearer + PAT

| Variable | Value |
|----------|--------|
| `AUTH_MODE` | `bearer` |
| `JIRA_API_TOKEN` | Jira Personal Access Token |
| `JIRA_EMAIL` | **Not used** for bearer |

### Add secrets to Tessen

Secrets must be **`KEY=VALUE`** — the CLI does not prompt interactively.

#### Option A — one command

```bash
tessen -k test namespace secrets add \
  AUTH_MODE=bearer \
  JIRA_API_TOKEN='<your-pat>'
```

#### Option B — from `.env`

```bash
grep -E '^(JIRA_API_TOKEN|AUTH_MODE|JIRA_BASE_URL|PROJECT_KEY)=' .env > .env.tessen
tessen -k test namespace secrets add --from-file .env.tessen
rm .env.tessen
```

#### Verify secret keys exist

```bash
tessen -k test namespace secrets list
```

Expected names (values are hidden — this is normal):

- `JIRA_API_TOKEN`
- `AUTH_MODE`

> **Message you may see:** *"Secret values are never returned by the API"* — that means listing worked; proceed to redeploy.

#### How secrets reach the app

In `docker-compose.yml`:

```yaml
tessen.secrets.JIRA_API_TOKEN: ".JIRA_API_TOKEN"
```

### Test your PAT locally

```bash
export $(grep -v '^#' .env | xargs)
curl -sS \
  -H "Authorization: Bearer $JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/2/myself" | head -20
```

- **Good:** JSON user object  
- **Bad:** HTML / `<!DOCTYPE` → fix token or VPN before deploying

---

## Deploy to test (step by step)

Run all commands from the **repository root**.

### Step 1 — Configure Docker

```bash
tessen docker config
```

### Step 2 — Build and push the image

```bash
bash scripts/build-and-push.sh
```

**Success looks like:**

- Build completes without error  
- Line with `pushed` and `digest: sha256:...`  
- Tag `.../support-tickets-dashboard:local` (when deploying manually from your laptop)

> Without this step, the cluster will show **`ErrImagePull`** / **`not found`**.

### Step 3 — Deploy to test

```bash
CLUSTER=test bash scripts/tessen-deploy.sh
```

Or explicitly:

```bash
tessen -k test deployment up \
  -E AUTH_MODE=bearer \
  -i support-tickets-dashboard=europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:local
```

**Success looks like:**

- `ok Deployment`, `ok Secret`, `ok Service`  
- Especially: **`ok Secret`** `csops-ops-csops-tickets-test-dashboard-tessen-env`

### Step 4 — Check pod status

```bash
tessen -k test status
```

Wait for **`READY 1/1`** (not `ImagePullBackOff` or `NOT_READY`).

### Step 5 — Smoke test APIs

```bash
curl -sS "https://support-tickets-dashboard.test.app.tessen.unity.com/healthz"
```

Expected:

```json
{"ok":true,"hasJiraToken":true,"authMode":"bearer","jiraBaseUrl":"https://jira.unity3d.com"}
```

```bash
curl -sS "https://support-tickets-dashboard.test.app.tessen.unity.com/api/data" | head -c 200
```

Expected: JSON starting with `{"version":` — **not** `{"error":`

### Step 6 — Open the dashboard

https://support-tickets-dashboard.test.app.tessen.unity.com  

Hard refresh: **Cmd+Shift+R**

### After any code change

Always repeat **build → push → deploy**:

```bash
bash scripts/build-and-push.sh
CLUSTER=test bash scripts/tessen-deploy.sh
```

---

## GitHub

### What is in the repo

- Application source, Dockerfile, `docker-compose.yml`, `.tessen.yml`  
- `scripts/build-and-push.sh`, `scripts/tessen-deploy.sh`  
- `.github/workflows/tessen-deploy-*.yml`  
- This guide: `docs/DEPLOYMENT.md`

### What must never be pushed

- `.env` (contains `JIRA_API_TOKEN`)  
- `node_modules/`

### Push changes

```bash
git add .
git status    # confirm .env is NOT listed
git commit -m "Describe your change"
git push origin main
```

---

## CI/CD with GitHub Actions

### Workflows

| File | When it runs | Cluster |
|------|----------------|---------|
| `tessen-deploy-test.yml` | Push to `main`, manual | test |
| `tessen-deploy-stg.yml` | Manual | stg |
| `tessen-deploy-prd.yml` | Manual | prd |

### Required GitHub secret

1. Repo → **Settings** → **Secrets and variables** → **Actions**  
2. **New repository secret**  
   - Name: `TESSEN_TOKEN`  
   - Value: team CI token ([Tessen CI docs](https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/ci-deploy/#tokens-for-ci))

### CI image tag

On GitHub Actions, the image tag is the **first 8 characters of `GITHUB_SHA`**, not `local`.

---

## Commands cheat sheet

### Deploy test

```bash
tessen docker config
bash scripts/build-and-push.sh
CLUSTER=test bash scripts/tessen-deploy.sh
tessen -k test status
```

### Observe

```bash
tessen -k test logs
tessen -k test dashboard logs
```

### Secrets

```bash
tessen -k test namespace secrets list
tessen -k test namespace secrets add JIRA_API_TOKEN='<pat>'
```

### Promote (when approved)

```bash
CLUSTER=stg bash scripts/tessen-deploy.sh
CLUSTER=prd bash scripts/tessen-deploy.sh
```

### Preview without applying

```bash
COMMAND=diff CLUSTER=test bash scripts/tessen-deploy.sh
```

---

## Troubleshooting

### `command not found: npm`

| | |
|---|---|
| **Cause** | Node not installed locally |
| **Fix** | Ignore for deploy. Use `bash scripts/build-and-push.sh` — npm runs inside Docker |

---

### `unable to parse secrets arguments` / `provide either KEY=VALUE`

| | |
|---|---|
| **Cause** | Ran `tessen namespace secrets add` with no `KEY=VALUE` |
| **Fix** | `tessen -k test namespace secrets add JIRA_API_TOKEN='<pat>'` or `--from-file .env.tessen` |

---

### `ErrImagePull` / `ImagePullBackOff` / `not found` for `:local`

| | |
|---|---|
| **Cause** | Image not pushed to Artifact Registry |
| **Fix** | `tessen docker config` → `bash scripts/build-and-push.sh` (must see **pushed**) → redeploy |

---

### Browser: 404 on some resource

| | |
|---|---|
| **Cause** | Often `favicon.ico` or missing `public/` folder |
| **Fix** | Safe to ignore if `/api/data` works |

---

### Browser: `/api/data` returns 500

| | |
|---|---|
| **Cause** | Server error — usually Jira auth or missing token |
| **Fix** | `curl .../api/data` and `tessen -k test logs`; fix secrets and redeploy |

---

### `{"error":"JIRA_EMAIL required for basic auth"}`

| | |
|---|---|
| **Cause** | `AUTH_MODE=basic` but email not in pod |
| **Fix** | Unity Jira needs **bearer**, not basic. See [Jira authentication](#jira-authentication) |

---

### `Jira API error 403: Basic Authentication has been disabled`

| | |
|---|---|
| **Cause** | `AUTH_MODE=basic` on Unity Jira |
| **Fix** | `AUTH_MODE=bearer`, update secrets, redeploy with `-E AUTH_MODE=bearer` |

---

### `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

| | |
|---|---|
| **Cause** | Jira returned HTML (login page) — invalid or missing PAT |
| **Fix** | Use bearer + valid PAT; `bash scripts/build-and-push.sh` and redeploy latest code |

---

### `Secret values are never returned by the API`

| | |
|---|---|
| **Cause** | Normal behavior for `namespace secrets list` |
| **Fix** | None. Redeploy after adding secrets |

---

### Dashboard empty but `curl /api/data` works

| | |
|---|---|
| **Cause** | Browser cache |
| **Fix** | Cmd+Shift+R; DevTools → Network → `api/data` |

---

### URL not loading / DNS

| | |
|---|---|
| **Cause** | DNS propagation after first deploy |
| **Fix** | Wait up to ~5 minutes; check `tessen -k test status` |

---

## Security

- Do **not** commit `.env` or share PATs in Slack, tickets, or email  
- Rotate Jira PAT if it was ever exposed  
- Cluster exposure is **internal** (`tessen.label.confidentiality: internal`)  
- Optional SSO on ingress: `tessen.proxy.http.auth: "okta"` in `docker-compose.yml`

---

## Official Tessen links

- [Quick start](https://developer.portal.internal.unity.com/docs/default/Component/tessen/workflows/quick-start/)
- [CI deploy & tokens](https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/ci-deploy/)
- [Secrets](https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/secrets/)
- [Troubleshooting](https://developer.portal.internal.unity.com/docs/default/Component/tessen/troubleshooting/)

---

*Guide version: 2026-05-25 · Namespace `csops-ops-csops-tickets-test-dashboard` on Tessen test.*
