# Support Tickets Dashboard

Internal **CSOP Jira** dashboard: open-issue metrics, charts, and top issues. Deployed on Unity **Tessen** (test).

| Environment | URL |
|-------------|-----|
| **Test** | https://support-tickets-dashboard.test.app.tessen.unity.com |

## For teammates

**Deployment guide (formatted Markdown):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)  

Open in GitHub, VS Code preview, or any Markdown viewer for headings, tables, and callouts.

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

# Jira Dashboard Configuration Cheat Sheet

This cheat sheet summarizes the data sources, summary metrics, and chart configurations extracted from the `server.js` implementation.

## Data Sources

The dashboard relies on two primary JQL queries to fetch issue data from Jira. Both queries are capped at a maximum of **500 records** to ensure performance.

| Variable | JQL Query | Capacity / Limit |
| :--- | :--- | :--- |
| `openIssues` | `project = CSOP AND resolution = Unresolved ORDER BY updated DESC` | 500 issues |
| `recentIssues` | `project = CSOP AND created >= -8w` | 500 issues |

---

## Summary Metrics

These top-level metrics provide an at-a-glance health status of the `CSOP` project. They are computed dynamically from the data sources loaded

| Metric | Calculation / Logic | Data Source |
| :--- | :--- | :--- |
| **Open Issues** | Total count (`openIssues.length`) | `openIssues` |
| **Created (7D)** | Count of issues where `created >= now - 7 days` | `recentIssues` |
| **Resolved (7D)** | Count of issues where `resolutiondate >= now - 7 days` | `recentIssues` |
| **Unassigned** | Count of issues where `assignee === 'Unassigned'` | `openIssues` |
| **High Priority Open** | Count of issues where `priority` includes `"high"` or `"critical"` *(case-insensitive)* | `openIssues` |
| **Avg Open Age (Days)** | Mean of (`today - created`) in days across all items, rounded to 1 decimal place | `openIssues` |

---

## Charts

The following breakdowns are rendered visually on the dashboard frontend. 

| Chart Name | Data Source | Grouping Dimension | Limit / Logic |
| :--- | :--- | :--- | :--- |
| **Open by Status** | `openIssues` | `status` | Top 12 groups |
| **Open by Priority** | `openIssues` | `priority` | Top 10 groups |
| **Open by Assignee** | `openIssues` | `assignee` | Top 10 groups |
| **Open by Issue Type** | `openIssues` | `issueType` | Top 10 groups |
| **Created per Week** | `recentIssues` | Week of `created` (ISO Week: Mon–Sun) | All 8 weeks included |
