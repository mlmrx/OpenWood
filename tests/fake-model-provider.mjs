import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 1919;
const fallbackDelayMs = 10_000;
const pending = new Set();
let requestCount = 0;

const fixtureResult = {
  summary: 'Fixture result that must be rejected after the human brief changes.',
  artifacts: [{
    kind: 'greenlight-memo',
    title: 'Stale fixture greenlight memo',
    content: {
      decision: 'greenlight',
      audiencePromise: 'A deterministic fixture promise that must never persist.',
      seriesEngine: 'A deterministic fixture engine that must never persist.',
      feasibility: 'Feasible only as an acceptance fixture.',
      risks: ['This result was produced from a superseded brief.'],
      revisionsRequired: [],
    },
  }],
  issues: [{
    severity: 'warning',
    title: 'STALE_STAGE_SENTINEL',
    evidence: 'This issue must not be committed after the creative brief changes.',
  }],
};

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

function waitForRelease() {
  return new Promise((resolve) => {
    const release = () => {
      clearTimeout(timer);
      pending.delete(release);
      resolve();
    };
    const timer = setTimeout(release, fallbackDelayMs);
    pending.add(release);
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', requestCount, waiting: pending.size });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/release') {
    const releases = [...pending];
    for (const release of releases) release();
    json(response, 200, { released: releases.length });
    return;
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    json(response, 404, { error: 'Fixture route not found.' });
    return;
  }

  try {
    const body = await readJson(request);
    if (body.model !== 'openwood-fixture' || !Array.isArray(body.messages)) {
      json(response, 400, { error: 'Expected the openwood-fixture chat-completions request.' });
      return;
    }

    requestCount += 1;
    process.stdout.write(`holding fixture request ${requestCount}\n`);
    await waitForRelease();
    json(response, 200, {
      id: `chatcmpl-openwood-${requestCount}`,
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(fixtureResult) },
        finish_reason: 'stop',
      }],
    });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : 'Invalid fixture request.' });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`OpenWood fake model provider listening on http://${host}:${port}\n`);
});

function close() {
  for (const release of pending) release();
  server.close(() => process.exit(0));
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
