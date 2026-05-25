require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;
const cache = new NodeCache({ stdTTL: 180 }); // Replaces CacheService

// --- CONFIGURATION ---
const CONFIG = {
  JIRA_BASE_URL: process.env.JIRA_BASE_URL || 'https://jira.unity3d.com',
  PROJECT_KEY: process.env.PROJECT_KEY || 'CSOP',
  API_VERSION: '2',
  AUTH_MODE: process.env.AUTH_MODE || 'bearer',
  JIRA_EMAIL: process.env.JIRA_EMAIL || '',
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  POLL_INTERVAL_MS: 30000,
  MAX_ISSUES_PER_QUERY: 500,
  JQL: {
    OPEN: 'project = CSOP AND resolution = Unresolved ORDER BY updated DESC',
    CREATED_8W: 'project = CSOP AND created >= -8w',
  },
  FIELDS: [
    'summary', 'status', 'priority', 'assignee', 'reporter', 
    'issuetype', 'created', 'updated', 'resolutiondate', 'labels', 'components'
  ],
};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// --- JIRA SERVICE EQUIVALENT ---

function getAuthHeaders() {
  if (!CONFIG.JIRA_API_TOKEN) {
    throw new Error(
      'JIRA_API_TOKEN is not set. Add it to .env locally, or for Tessen: tessen -k test namespace secrets add JIRA_API_TOKEN then redeploy.'
    );
  }
  const headers = { 'Accept': 'application/json' };
  if (CONFIG.AUTH_MODE === 'basic') {
    if (!CONFIG.JIRA_EMAIL) throw new Error('JIRA_EMAIL required for basic auth');
    const b64 = Buffer.from(`${CONFIG.JIRA_EMAIL}:${CONFIG.JIRA_API_TOKEN}`).toString('base64');
    headers['Authorization'] = `Basic ${b64}`;
  } else {
    headers['Authorization'] = `Bearer ${CONFIG.JIRA_API_TOKEN}`;
  }
  return headers;
}

async function jiraFetch(apiPath, queryParams = {}) {
  const url = new URL(`${CONFIG.JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/${CONFIG.API_VERSION}${apiPath}`);
  Object.keys(queryParams).forEach(key => {
    if (queryParams[key] !== undefined && queryParams[key] !== '') {
      url.searchParams.append(key, queryParams[key]);
    }
  });

  const response = await fetch(url, { method: 'GET', headers: getAuthHeaders() });
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error(`Jira API error ${response.status}: ${body.slice(0, 400)}`);
  }

  if (contentType.includes('text/html') || body.trimStart().startsWith('<!')) {
    throw new Error(
      'Jira returned HTML instead of JSON (login page or bad token). ' +
        `Use AUTH_MODE=bearer with a valid Jira PAT in JIRA_API_TOKEN. AUTH_MODE=${CONFIG.AUTH_MODE}. ` +
        `Check ${CONFIG.JIRA_BASE_URL} and VPN.`
    );
  }

  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error(
      `Jira returned non-JSON (${e.message}). First bytes: ${body.slice(0, 120)}`
    );
  }
}

function normalizeIssue(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    summary: f.summary || '',
    status: f.status?.name || 'Unknown',
    priority: f.priority?.name || 'None',
    issueType: f.issuetype?.name || 'Unknown',
    assignee: f.assignee?.displayName || 'Unassigned',
    created: f.created || '',
    updated: f.updated || '',
    resolved: f.resolutiondate || '',
    url: `${CONFIG.JIRA_BASE_URL}/browse/${issue.key}`,
  };
}

async function searchIssues(jql, startAt, maxResults) {
  const data = await jiraFetch('/search', {
    jql, startAt, maxResults, fields: CONFIG.FIELDS.join(',')
  });
  return { total: data.total || 0, issues: (data.issues || []).map(normalizeIssue) };
}

async function searchAllIssues(jql, cap = CONFIG.MAX_ISSUES_PER_QUERY) {
  const all = [];
  let startAt = 0;
  const pageSize = 100;
  while (all.length < cap) {
    const remaining = cap - all.length;
    const page = await searchIssues(jql, startAt, Math.min(pageSize, remaining));
    all.push(...page.issues);
    if (all.length >= page.total || page.issues.length === 0) break;
    startAt += page.issues.length;
  }
  return all;
}

function fingerprintIssues(issues) {
  const hash = crypto.createHash('sha256');
  hash.update(issues.map(i => `${i.key}|${i.updated}`).join('\n'));
  return hash.digest('base64').slice(0, 16);
}

// Analytics Helpers
function countBy(issues, keyFn) {
  const map = {};
  issues.forEach(issue => {
    const key = keyFn(issue);
    map[key] = (map[key] || 0) + 1;
  });
  return Object.keys(map).map(label => ({ label, count: map[label] })).sort((a, b) => b.count - a.count);
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function issuesByWeek(issues, dateField) {
  const map = {};
  issues.forEach(issue => {
    const raw = issue[dateField];
    if (!raw) return;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return;
    
    // Simple format "MMM D"
    const weekStart = getWeekStart(d);
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    map[label] = (map[label] || 0) + 1;
  });
  return Object.keys(map).map(label => ({ label, count: map[label] })).sort((a, b) => new Date(a.label) - new Date(b.label));
}

function daysBetween(startIso, endDate) {
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return 0;
  return Math.max(0, (endDate - start) / (1000 * 60 * 60 * 24));
}

function summarize(openIssues, recentIssues) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const createdThisWeek = recentIssues.filter(i => new Date(i.created) >= weekAgo).length;
  const resolvedThisWeek = recentIssues.filter(i => i.resolved && new Date(i.resolved) >= weekAgo).length;
  const unassigned = openIssues.filter(i => i.assignee === 'Unassigned').length;
  const highPriorityOpen = openIssues.filter(i => {
    const p = i.priority.toLowerCase();
    return p.includes('high') || p.includes('critical');
  }).length;

  const ages = openIssues.map(i => daysBetween(i.created, now));
  const avgAgeDays = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;

  return { totalOpen: openIssues.length, createdThisWeek, resolvedThisWeek, unassigned, highPriorityOpen, avgOpenAgeDays: Math.round(avgAgeDays * 10) / 10 };
}

function buildCharts(openIssues, recentIssues) {
  return {
    byStatus: { type: 'pie', items: countBy(openIssues, i => i.status).slice(0, 12) },
    byPriority: { type: 'column', items: countBy(openIssues, i => i.priority).slice(0, 10) },
    byAssignee: { type: 'bar', items: countBy(openIssues, i => i.assignee).slice(0, 10) },
    byIssueType: { type: 'pie', items: countBy(openIssues, i => i.issueType).slice(0, 10) },
    createdPerWeek: { type: 'line', items: issuesByWeek(recentIssues, 'created') },
  };
}

async function readDashboardPayload() {
  const openIssues = await searchAllIssues(CONFIG.JQL.OPEN);
  const recentIssues = await searchAllIssues(CONFIG.JQL.CREATED_8W);
  const version = fingerprintIssues(openIssues);
  
  return {
    version,
    generatedAt: new Date().toISOString(),
    meta: {
      projectKey: CONFIG.PROJECT_KEY,
      jiraBaseUrl: CONFIG.JIRA_BASE_URL,
      openCount: openIssues.length,
    },
    summary: summarize(openIssues, recentIssues),
    charts: buildCharts(openIssues, recentIssues),
    openIssues: openIssues.slice(0, 100),
  };
}

// In-flight request lock to prevent thundering herds
let refreshPromise = null; 

async function getDashboardData(forceRefresh) {
  const cacheKey = 'jira-dashboard:csop';
  
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  // Act as a LockService substitute
  if (refreshPromise) return refreshPromise;

  refreshPromise = readDashboardPayload().then(payload => {
    cache.set(cacheKey, payload);
    refreshPromise = null;
    return payload;
  }).catch(err => {
    refreshPromise = null;
    throw err;
  });

  return refreshPromise;
}

// --- EXPRESS ROUTES ---

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    hasJiraToken: Boolean(CONFIG.JIRA_API_TOKEN),
    authMode: CONFIG.AUTH_MODE,
    jiraBaseUrl: CONFIG.JIRA_BASE_URL,
  });
});

// 1. Initial Page Load (Replaces doGet)
app.get('/', (req, res) => {
  res.render('index', {
    config: {
      pollIntervalMs: CONFIG.POLL_INTERVAL_MS,
      appTitle: 'CSOP Jira Dashboard',
      projectKey: CONFIG.PROJECT_KEY,
      jiraBaseUrl: CONFIG.JIRA_BASE_URL,
      projectUrl: `${CONFIG.JIRA_BASE_URL}/projects/${CONFIG.PROJECT_KEY}/issues`
    }
  });
});

// 2. Data Endpoint (Replaces google.script.run.getDashboardData)
app.get('/api/data', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    if (force) cache.flushAll(); // Replaces JiraService.invalidateCache()
    const data = await getDashboardData(force);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Version Endpoint (Replaces google.script.run.getDataVersion)
app.get('/api/version', async (req, res) => {
  try {
    const openIssues = await searchAllIssues(CONFIG.JQL.OPEN, 200);
    res.json({ version: fingerprintIssues(openIssues) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Jira Dashboard listening on port ${port}`);
});