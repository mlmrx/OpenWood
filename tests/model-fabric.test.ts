import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_LANE_REGISTRY,
  buildStructuredChatBody,
  inspectModelFabric,
  modelLaneForStage,
  resolveModelRoute,
  resolveModelRouteForStage,
  type ModelEnvironment,
} from '../lib/providers/model-fabric';

const legacy: ModelEnvironment = {
  OPENWOOD_LLM_BASE_URL: 'https://models.example.test/v1/',
  OPENWOOD_LLM_MODEL: 'studio-default',
  OPENWOOD_LLM_API_KEY: 'never-return-this-secret',
};

void test('production stages select a stable craft lane', () => {
  for (const stage of ['bible', 'outline', 'participation', 'script']) assert.equal(modelLaneForStage(stage), 'story');
  for (const stage of ['brief', 'direction', 'look', 'shots', 'sound', 'assets', 'cut']) assert.equal(modelLaneForStage(stage), 'planning');
  for (const stage of ['coverage', 'continuity', 'rights', 'qc']) assert.equal(modelLaneForStage(stage), 'critic');
  assert.equal(modelLaneForStage('future-stage'), 'planning');
});

void test('a lane-specific route wins and missing lanes retain the legacy fallback', () => {
  const values: ModelEnvironment = {
    ...legacy,
    OPENWOOD_STORY_LLM_BASE_URL: 'http://127.0.0.1:1919/v1',
    OPENWOOD_STORY_LLM_MODEL: 'Qwen3.6-35B-A3B',
    OPENWOOD_STORY_LLM_PROVIDER: 'freetoken',
  };
  const story = resolveModelRouteForStage(values, 'script');
  const critic = resolveModelRouteForStage(values, 'qc');
  assert.equal(story?.source, 'lane');
  assert.equal(story?.provider, 'freetoken');
  assert.equal(story?.model, 'Qwen3.6-35B-A3B');
  assert.equal(critic?.source, 'legacy');
  assert.equal(critic?.model, 'studio-default');
});

void test('FreeToken defaults to local, prompt-enforced JSON with conservative concurrency', () => {
  const route = resolveModelRoute({
    OPENWOOD_STORY_LLM_BASE_URL: 'http://localhost:1919/v1/',
    OPENWOOD_STORY_LLM_MODEL: 'local-moe',
    OPENWOOD_STORY_LLM_PROVIDER: 'freetoken',
  }, 'story');
  assert.ok(route);
  assert.equal(route.baseUrl, 'http://localhost:1919/v1');
  assert.equal(route.dataBoundary, 'local');
  assert.equal(route.structuredOutput, 'prompt');
  assert.equal(route.maxConcurrency, 1);
  assert.equal(route.maxOutputTokens, MODEL_LANE_REGISTRY.story.defaultMaxOutputTokens);
  const body = buildStructuredChatBody(route, { system: 'contract', user: 'story', temperature: 0.7 });
  assert.equal(body.model, 'local-moe');
  assert.equal(body.max_tokens, 8192);
  assert.equal('response_format' in body, false);
});

void test('operators can declare verified native JSON and bounded runtime limits', () => {
  const route = resolveModelRoute({
    OPENWOOD_CRITIC_LLM_BASE_URL: 'https://judge.example.test/v1',
    OPENWOOD_CRITIC_LLM_MODEL: 'critic-r17',
    OPENWOOD_CRITIC_LLM_MODEL_REVISION: 'sha256:abc123',
    OPENWOOD_CRITIC_LLM_JSON_MODE: 'native',
    OPENWOOD_CRITIC_LLM_MAX_OUTPUT_TOKENS: '999999',
    OPENWOOD_CRITIC_LLM_TIMEOUT_MS: '1',
    OPENWOOD_CRITIC_LLM_MAX_CONCURRENCY: '0',
  }, 'critic');
  assert.ok(route);
  assert.equal(route.structuredOutput, 'native');
  assert.equal(route.modelRevision, 'sha256:abc123');
  assert.equal(route.maxOutputTokens, 32_768);
  assert.equal(route.timeoutMs, 5_000);
  assert.equal(route.maxConcurrency, 1);
  const body = buildStructuredChatBody(route, { system: 'contract', user: 'audit', temperature: 5 });
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.temperature, 2);
});

void test('incomplete and invalid routes fail closed with safe diagnostics', () => {
  const incomplete = inspectModelFabric({ OPENWOOD_STORY_LLM_MODEL: 'orphan-model' });
  assert.equal(incomplete.configured, false);
  assert.match(incomplete.diagnostics.join(' '), /both OPENWOOD_STORY_LLM_BASE_URL and OPENWOOD_STORY_LLM_MODEL/i);

  const invalid = inspectModelFabric({
    OPENWOOD_LLM_BASE_URL: 'file:///private/model',
    OPENWOOD_LLM_MODEL: 'unsafe-scheme',
  });
  assert.equal(invalid.configured, false);
  assert.match(invalid.diagnostics.join(' '), /invalid HTTP\(S\) base URL/i);
});

void test('public fabric status exposes routing facts but no endpoint or credential', () => {
  const status = inspectModelFabric(legacy);
  assert.equal(status.configured, true);
  assert.equal(status.routes.length, 3);
  assert.ok(status.routes.every((route) => route.source === 'legacy'));
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /models\.example\.test/);
  assert.doesNotMatch(serialized, /never-return-this-secret/);
});

void test('v1 advertises only capabilities it actually executes', () => {
  const serialized = JSON.stringify(MODEL_LANE_REGISTRY);
  assert.match(serialized, /text-generation/);
  assert.match(serialized, /structured-output/);
  assert.doesNotMatch(serialized, /image-generation|video-generation|voice-synthesis/);
});
