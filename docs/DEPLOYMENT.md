# Support Tickets Dashboard — Deployment Guide

Internal CSOP Jira dashboard deployed to Unity **Tessen** (Kubernetes on GCP). This document covers setup, deploy, GitHub, and troubleshooting based on the team’s first deployment (May 2026).

**Live (test):** https://support-tickets-dashboard.test.app.tessen.unity.com  
**GitHub:** https://github.com/rohinimohan-create/support-tickets-dashboard  
**Help channel:** `#devs-tessen`

---

## Table of contents

1. [What this project is](#what-this-project-is)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Naming reference](#naming-reference)
5. [First-time setup](#first-time-setup)
6. [Jira authentication](#jira-authentication)
7. [Manual deploy to test](#manual-deploy-to-test)
8. [GitHub repository](#github-repository)
9. [CI/CD (GitHub Actions)](#cicd-github-actions)
10. [Day-to-day commands](#day-to-day-commands)
11. [Troubleshooting](#troubleshooting)

---

## What this project is

- **Node.js / Express** app (`server.js`) that queries **Jira** (CSOP project) and serves a web UI (`views/index.ejs`).
- Packaged as a **Docker** image and deployed with **Tessen** using `docker-compose.yml`.
- No Kubernetes knowledge required for routine deploys — Tessen maps Compose → GKE (ingress, TLS, secrets, monitoring).

---

## Architecture

```
Developer machine / GitHub Actions
    │
    ├─ docker build + push  →  Artifact Registry
    │     europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/
    │       <namespace>/support-tickets-dashboard:<tag>
    │
    └─ tessen deployment up  →  Tessen (test / stg / prd GKE)
              │
              ├─ Namespace, ingress, TLS
              ├─ Secrets from Vault (JIRA_API_TOKEN, etc.)
              └─ Pod runs Node app on port 8080
```

**Important:** `.env` on your laptop is **not** used in the cluster. Runtime config comes from **Tessen namespace secrets** and deploy flags (`-E`).

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Tessen CLI** | `brew install --cask tessen` or [Tessen releases](https://github.com/Unity-Technologies/tessen/releases) |
| **Docker Desktop** | Running; `docker ps` works |
| **Tessen login** | `tessen auth login` |
| **Team membership** | Must be on Tessen team **`csops-ops`** |
| **VPN** | Unity corporate network (for Jira + internal URLs) |
| **Jira PAT** | Personal Access Token for `https://jira.unity3d.com` |
| **Git** | For GitHub and image tags in CI |

You do **not** need local `npm` for deploy — dependencies install inside `docker build`.

---

## Naming reference

| Concept | Value for this project |
|---------|-------------------------|
| **Tessen team** | `csops-ops` |
| **Project slug** | `csops-tickets-test-dashboard` (chosen at `tessen init`) |
| **Namespace** | `csops-ops-csops-tickets-test-dashboard` (`<team>-<project>`) |
| **Compose service name** | `support-tickets-dashboard` |
| **Image path** | `europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:<tag>` |
| **Test URL** | https://support-tickets-dashboard.test.app.tessen.unity.com |

Config lives in `.tessen.yml` (namespace + default cluster).

---

## First-time setup

### 1. Clone the repo

```bash
git clone https://github.com/rohinimohan-create/support-tickets-dashboard.git
cd support-tickets-dashboard
```

### 2. Local environment (development only)

Copy and edit (never commit):

```bash
# .env — gitignored
PORT=8080
JIRA_BASE_URL=https://jira.unity3d.com
PROJECT_KEY=CSOP
AUTH_MODE=bearer
JIRA_API_TOKEN=<your-jira-pat>
# JIRA_EMAIL only if using basic (disabled on Unity Jira — see below)
```

### 3. Tessen init (already done in repo)

If starting from scratch:

```bash
tessen init
```

This generates `.tessen.yml`, `docker-compose.yml`, `docker/support-tickets-dashboard.Dockerfile`, `scripts/`, and `.github/workflows/`.

### 4. Docker registry auth

```bash
tessen docker config
```

Confirm `europe-docker.pkg.dev` uses the **tessen** credential helper in `~/.docker/config.json`. Select **Continue** if prompted.

---

## Jira authentication

Unity Jira (`jira.unity3d.com`) **does not allow HTTP Basic auth** (email + token). You will see:

```json
{"message":"Basic Authentication has been disabled on this instance."}
```

### Use bearer + Personal Access Token

| Setting | Value |
|---------|--------|
| `AUTH_MODE` | `bearer` |
| `JIRA_API_TOKEN` | Jira Personal Access Token |
| `JIRA_EMAIL` | Not required for bearer |

### Add secrets to Tessen (required for cluster)

Secrets use **`KEY=VALUE`** syntax (no interactive prompt):

```bash
# From project root — quoted values recommended
tessen -k test namespace secrets add \
  AUTH_MODE=bearer \
  JIRA_API_TOKEN='<your-pat>'

# Or import Jira-related lines from .env
grep -E '^(JIRA_API_TOKEN|AUTH_MODE|JIRA_BASE_URL|PROJECT_KEY)=' .env > .env.tessen
tessen -k test namespace secrets add --from-file .env.tessen
rm .env.tessen
```

List keys (values are never shown):

```bash
tessen -k test namespace secrets list
```

Expected keys: `JIRA_API_TOKEN`, `AUTH_MODE` (and optionally `JIRA_BASE_URL`, `PROJECT_KEY`).

Secrets are wired in `docker-compose.yml`:

```yaml
tessen.secrets.JIRA_API_TOKEN: ".JIRA_API_TOKEN"
tessen.secrets.JIRA_EMAIL: ".JIRA_EMAIL"
```

### Verify Jira token locally

```bash
export $(grep -v '^#' .env | xargs)
curl -sS \
  -H "Authorization: Bearer $JIRA_API_TOKEN" \
  -H "Accept: application/json" \
  "$JIRA_BASE_URL/rest/api/2/myself" | head -20
```

You should get **JSON** (user profile), not HTML.

---

## Manual deploy to test

Run from repository root, in order:

### Step 1 — Build and push image

```bash
tessen docker config
bash scripts/build-and-push.sh
```

- Without `GITHUB_SHA`, tag is **`local`**.
- Must see **`pushed`** / `digest: sha256:...` — deploy will fail if this step is skipped.

### Step 2 — Deploy

```bash
CLUSTER=test bash scripts/tessen-deploy.sh
```

Or explicitly:

```bash
tessen -k test deployment up \
  -E AUTH_MODE=bearer \
  -i support-tickets-dashboard=europe-docker.pkg.dev/unity-cds-services-prd/ds-docker/csops-ops-csops-tickets-test-dashboard/support-tickets-dashboard:local
```

Look for **`ok Secret`** in output (env/secret sync).

### Step 3 — Verify

```bash
tessen -k test status          # READY 1/1
curl -sS https://support-tickets-dashboard.test.app.tessen.unity.com/healthz
curl -sS https://support-tickets-dashboard.test.app.tessen.unity.com/api/data | head -c 200
```

**Health check:** `{"ok":true,"hasJiraToken":true,"authMode":"bearer",...}`  

**Data check:** JSON starting with `{"version":` (not `{"error":`).

### Step 4 — Open dashboard

https://support-tickets-dashboard.test.app.tessen.unity.com (hard refresh: Cmd+Shift+R).

### After code changes

Always **rebuild, push, redeploy**:

```bash
bash scripts/build-and-push.sh
CLUSTER=test bash scripts/tessen-deploy.sh
```

---

## GitHub repository

### What is committed

- Application code, Dockerfile, `docker-compose.yml`, `.tessen.yml`
- `scripts/build-and-push.sh`, `scripts/tessen-deploy.sh`
- `.github/workflows/tessen-deploy-*.yml`

### What is NOT committed

- `.env` (tokens)
- `node_modules/`

### Initial push (already done)

```bash
git add .
git status   # confirm .env is absent
git commit -m "Your message"
git push -u origin main
```

---

## CI/CD (GitHub Actions)

Workflows (from `tessen init`):

| Workflow | Trigger | Cluster |
|----------|---------|---------|
| `tessen-deploy-test.yml` | Push to `main`, manual | test |
| `tessen-deploy-stg.yml` | Manual / branch policy | stg |
| `tessen-deploy-prd.yml` | Manual / branch policy | prd |

### Required GitHub secret

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|--------|
| `TESSEN_TOKEN` | Team CI service account token |

Docs: https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/ci-deploy/#tokens-for-ci

CI runs on **`unity-linux-runner`** with image `tessen/dind:latest`, then `scripts/build-and-push.sh` and `scripts/tessen-deploy.sh` (image tag = first 8 chars of `GITHUB_SHA`).

---

## Day-to-day commands

```bash
# Status and logs
tessen -k test status
tessen -k test logs
tessen -k test dashboard logs

# Redeploy same image
CLUSTER=test bash scripts/tessen-deploy.sh

# Update secrets then redeploy
tessen -k test namespace secrets add JIRA_API_TOKEN='...'
CLUSTER=test bash scripts/tessen-deploy.sh

# Preview diff without applying
COMMAND=diff CLUSTER=test bash scripts/tessen-deploy.sh

# Promote (when ready)
CLUSTER=stg bash scripts/tessen-deploy.sh
CLUSTER=prd bash scripts/tessen-deploy.sh
```

---

## Troubleshooting

### `command not found: npm`

**Cause:** Node not installed locally.  
**Fix:** Not required. Use `bash scripts/build-and-push.sh` (npm runs inside Docker).

---

### `unable to parse secrets arguments` / `provide either KEY=VALUE arguments or --from-file`

**Cause:** `tessen namespace secrets add` without `KEY=VALUE`.  
**Fix:**

```bash
tessen -k test namespace secrets add JIRA_API_TOKEN='your-token'
# or
tessen -k test namespace secrets add --from-file .env.tessen
```

---

### `ErrImagePull` / `ImagePullBackOff` / `not found` for `:local`

**Cause:** Image never pushed to Artifact Registry.  
**Fix:**

```bash
tessen docker config
bash scripts/build-and-push.sh   # must succeed with "pushed"
CLUSTER=test bash scripts/tessen-deploy.sh
```

---

### Browser: `Failed to load resource` 404

**Cause:** Usually missing `favicon.ico` or `public/` assets.  
**Fix:** Harmless; ignore unless a required asset 404s.

---

### Browser: `/api/data` 500

**Cause:** Server error (Jira auth, missing token).  
**Fix:** Check Network → Response body, or:

```bash
curl -sS https://support-tickets-dashboard.test.app.tessen.unity.com/api/data
tessen -k test logs
```

---

### `{"error":"JIRA_EMAIL required for basic auth"}`

**Cause:** `AUTH_MODE=basic` but `JIRA_EMAIL` not in pod secrets.  
**Fix:** Unity Jira disables basic — switch to bearer (below). If you truly need basic elsewhere:

```bash
tessen -k test namespace secrets add JIRA_EMAIL='you@unity3d.com'
CLUSTER=test tessen -k test deployment up -E AUTH_MODE=basic -i <image>
```

---

### `Jira API error 403: Basic Authentication has been disabled on this instance`

**Cause:** `AUTH_MODE=basic` against Unity Jira.  
**Fix:**

```bash
tessen -k test namespace secrets add AUTH_MODE=bearer JIRA_API_TOKEN='<pat>'
CLUSTER=test tessen -k test deployment up -E AUTH_MODE=bearer -i <image>
```

---

### `{"error":"Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"}`

**Cause:** Jira returned an HTML login page; old container build used `response.json()` on HTML.  
**Fix:**

1. Use valid **bearer PAT** and `AUTH_MODE=bearer`.
2. Rebuild and redeploy so latest `server.js` is running:

   ```bash
   bash scripts/build-and-push.sh
   CLUSTER=test bash scripts/tessen-deploy.sh
   ```

3. New errors should read *“Jira returned HTML instead of JSON…”* if auth is still wrong.

---

### `Secret values are never returned by the API`

**Cause:** Normal when running `tessen namespace secrets list`.  
**Fix:** None — confirms secrets exist by name only. Redeploy after adding secrets.

---

### Dashboard empty but `curl /api/data` works

**Cause:** Browser cache or old JS error.  
**Fix:** Hard refresh (Cmd+Shift+R); check DevTools → Network → `api/data`.

---

### DNS / URL not loading

**Cause:** DNS propagation after first deploy (up to ~5 minutes).  
**Fix:** Wait; `tessen -k test status` shows URL when ready.

---

## Security notes

- Never commit `.env` or paste PATs in Slack/docs/tickets.
- Rotate Jira PAT if exposed.
- Test cluster is **internal** (`tessen.label.confidentiality: internal`).
- Optional ingress SSO: uncomment `tessen.proxy.http.auth: "okta"` in `docker-compose.yml`.

---

## Quick reference card

```bash
# One-time / when secrets change
tessen -k test namespace secrets add --from-file .env.tessen

# Standard test deploy
tessen docker config
bash scripts/build-and-push.sh
CLUSTER=test bash scripts/tessen-deploy.sh
tessen -k test status
curl -sS https://support-tickets-dashboard.test.app.tessen.unity.com/api/data | head -c 100
```

---

## Related documentation

- [Tessen quick start](https://developer.portal.internal.unity.com/docs/default/Component/tessen/workflows/quick-start/)
- [Tessen CI deploy / tokens](https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/ci-deploy/)
- [Tessen secrets](https://developer.portal.internal.unity.com/docs/default/component/tessen/usage/secrets/)
- [Tessen troubleshooting](https://developer.portal.internal.unity.com/docs/default/Component/tessen/troubleshooting/)

---

*Document version: 2026-05-25 — reflects deployment to `csops-ops-csops-tickets-test-dashboard` on Tessen test.*
