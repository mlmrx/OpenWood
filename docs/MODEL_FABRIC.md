# OpenWood model fabric

OpenWood does not make a model—or a model-serving product—the studio. Models are replaceable craft engines behind durable artifacts, evidence gates, rights records, and human direction.

## FreeToken decision

[FreeToken](https://github.com/FlashML-org/FreeToken) is a compelling optional **local text inference route**. It serves OpenAI-compatible chat, Responses, and model-list APIs and is designed to run large mixture-of-experts checkpoints across consumer GPU, CPU, and host memory. That makes it a useful private writers-room engine with no per-token cloud bill.

It is not OpenWood's universal backend:

- FreeToken's supported-model documentation currently says multimodal checkpoints are served text-only. It does not generate OpenWood's images, footage, voices, music, or final masters.
- It is young infrastructure. Pin a tested release and checkpoint revision, run a contract probe before production, and begin with conservative concurrency.
- A public Cloudflare Worker cannot reach a loopback endpoint on a creator's computer. FreeToken works directly with local/self-hosted OpenWood; a hosted studio needs an operator-controlled private gateway or a future outbound local runner.
- “Open weight” does not automatically mean unrestricted commercial use. The deployment operator must record the checkpoint license and output terms separately.

The fabric therefore treats FreeToken as one OpenAI-compatible route, not a hard dependency.

## Routing lanes

| Lane | Stages | Selection objective |
| --- | --- | --- |
| Writers room | bible, outline, participation, script | Long-context canon, causal structure, Story Door pressure, voice, and scene craft |
| Production planning | brief, direction, look, shots, sound, assets, cut | Precise, feasible, structured production specifications |
| Independent review | coverage, continuity, rights, QC | Low-variance adversarial analysis from a different model family or operator when possible |

A complete lane-specific configuration wins for that lane. If it is absent or incomplete, OpenWood uses the existing global OPENWOOD_LLM_* route. Provider failures still fail loudly; v1 does not make an invisible cross-provider retry that would disappear from the run ledger.

Unknown future text stages use the conservative production-planning lane until explicitly classified.

## Configuration contract

Each lane uses the same suffixes, prefixed by OPENWOOD_STORY_LLM, OPENWOOD_PLANNING_LLM, or OPENWOOD_CRITIC_LLM:

| Suffix | Meaning |
| --- | --- |
| _BASE_URL | HTTP(S) OpenAI-compatible API root, normally ending in /v1 |
| _MODEL | Served model identifier |
| _PROVIDER | freetoken, ollama, vllm, or openai-compatible |
| _MODEL_REVISION | Operator-pinned checkpoint, commit, or weight digest |
| _API_KEY | Optional server-only bearer credential |
| _JSON_MODE | native sends response_format; prompt relies on the strict JSON prompt and parser |
| _DATA_BOUNDARY | Operator attestation: local, private, or hosted |
| _MAX_OUTPUT_TOKENS | Per-call ceiling, clamped to 256–32,768 |
| _TIMEOUT_MS | Per-call deadline, clamped to 5–180 seconds |
| _MAX_CONCURRENCY | Declared route capacity, clamped to 1–32; v1 reports it but does not yet schedule a distributed semaphore |

Example local story route:

    OPENWOOD_STORY_LLM_PROVIDER=freetoken
    OPENWOOD_STORY_LLM_BASE_URL=http://127.0.0.1:1919/v1
    OPENWOOD_STORY_LLM_MODEL=your-tested-model
    OPENWOOD_STORY_LLM_MODEL_REVISION=your-checkpoint-digest
    OPENWOOD_STORY_LLM_JSON_MODE=prompt
    OPENWOOD_STORY_LLM_DATA_BOUNDARY=local
    OPENWOOD_STORY_LLM_MAX_CONCURRENCY=1

No route is valid unless both base URL and model are present. Only HTTP(S) endpoints are accepted. /api/provider returns safe routing metadata and diagnostics; it never returns an endpoint or credential.

## Selection policy

Model Fabric v1 intentionally uses deterministic configuration rather than marketing-driven “latest model” selection:

1. classify the production stage into a craft lane;
2. select a complete lane route;
3. otherwise select the complete legacy route;
4. apply bounded output and deadline settings;
5. send native JSON mode only when the operator has declared it supported;
6. validate the existing structured artifact contract; and
7. fail loudly if the route is unavailable or its output is invalid.

This keeps existing deployments compatible while allowing a private local model for story, a fast planning model, and a genuinely separate critic.

## Production-grade roadmap

The next provider-fabric increment should be a durable job and attempt ledger, not a list of fashionable model names:

- immutable input snapshots containing project revision plus exact artifact versions and hashes;
- provider/model/weight revision, adapter version, prompt-template hash, seed and generation settings on every attempt;
- token, GPU-second, latency, cost, storage, and egress reservation before dispatch, with reconciliation afterward;
- task-specific quality evals and canaries used by the router;
- queue-backed execution with leases, heartbeats, cancellation, and a semaphore per deployment;
- retry and fallback chains recorded as attempts rather than hidden inside one run;
- quarantined media outputs that are signature-inspected, rights-reviewed, and content-addressed before becoming production assets; and
- an outbound authenticated local runner for private creator-owned compute.

Media should enter through separate typed capabilities—image generation/editing, video generation, speech, music, transcription, safety inspection, and deterministic FFmpeg render. An adapter is not “available” until it passes its task fixtures. Missing capability must remain visible; OpenWood never substitutes an animatic and calls it a rendered film.

## Concurrency invariant

The stage runner reads approved artifacts before a potentially long provider call, then commits only against the exact source state, project content revision, running lease, and output-artifact versions/newness that produced the result. Every generated revision, finding, run completion, and completion event enters one D1 transaction. If a human or another department changes the production first, the stale result is superseded, the whole batch rolls back, and the caller receives HTTP 409.

Running leases expire after five minutes—longer than the fabric's maximum 180-second provider timeout plus a two-minute recovery margin. Future queue workers should replace that conservative single-call lease with explicit heartbeats. This invariant is the foundation for safe parallel departments and creator-owned compute.
