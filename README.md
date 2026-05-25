# Support Tickets Dashboard

Internal **CSOP Jira** dashboard: open-issue metrics, charts, and top issues. Deployed on Unity **Tessen** (test).

| Environment | URL |
|-------------|-----|
| **Test** | https://support-tickets-dashboard.test.app.tessen.unity.com |

## For teammates

**Full deploy, GitHub, and troubleshooting guide:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Quick start (already onboarded)

```bash
git clone https://github.com/rohinimohan-create/support-tickets-dashboard.git
cd support-tickets-dashboard
cp .env.example .env   # create .env locally — see DEPLOYMENT.md
tessen docker config
bash scripts/build-and-push.sh
CLUSTER=test bash scripts/tessen-deploy.sh
```

## Stack

- Node.js / Express / EJS
- Jira REST API (`AUTH_MODE=bearer` + PAT)
- Docker → `europe-docker.pkg.dev/.../csops-ops-csops-tickets-test-dashboard/`
- Tessen + GitHub Actions

## Support

- Tessen: `#devs-tessen`
- Namespace: `csops-ops-csops-tickets-test-dashboard`
