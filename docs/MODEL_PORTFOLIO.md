# OpenWood model portfolio

Status: architecture recommendation reviewed 2026-09-12. Model availability, benchmark claims, hardware requirements, and licenses change; re-verify every weight and license at deployment time. OpenWood stores those decisions as provenance instead of treating a model name as permanent infrastructure.

## Decision

No single “latest” model is suitable for a production house. OpenWood should route each craft capability independently, evaluate it on cinematic fixtures, and retain a deterministic mastering path. The recommended portfolio is:

| Capability | Current candidate | Default posture |
| --- | --- | --- |
| Script, story architecture, directing, QC | [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B) | Apache-2.0 default candidate; benchmark against a separately operated critic route before adoption. |
| Local MoE text serving | [FlashML FreeToken](https://github.com/FlashML-org/FreeToken) with a pinned, tested checkpoint | Experimental economy/privacy route. Its documented multimodal checkpoints are text-only through this runtime. |
| Fast storyboard preview | [FLUX.2 Klein 4B](https://github.com/black-forest-labs/flux2) | Apache-2.0 preview worker; do not silently substitute differently licensed FLUX variants. |
| Final still and continuity reference | [HiDream-O1-Image](https://github.com/HiDream-ai/HiDream-O1-Image) | MIT candidate for conditioned character/look work. |
| Hero video with synchronized sound | [LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5) | Strong product fit only when its community/commercial license and hardware envelope fit the operator. |
| Permissive video fallback | [Wan2.2 TI2V-5B](https://github.com/Wan-Video/Wan2.2) | Apache-2.0 fallback for approved shots; generation latency makes it an asynchronous worker. |
| Controlled character motion | [SCAIL-2](https://github.com/zai-org/SCAIL-2) | Apache-2.0 specialist after identity and visual references are approved. |
| Character dialogue | [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | Apache-2.0 voice candidate. Designed synthetic voices are the default; cloning requires recorded consent. |
| Original score sketches | [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) | MIT candidate with retained prompts/references and a separate music-rights review. |
| Assembly and master | FFmpeg plus OpenWood validation | Deterministic, non-generative timeline, captions, loudness, codec, checksum, and playback gates. |

Other frontier text checkpoints can enter as challengers, never by marketing rank alone. Each candidate must pass the same blinded OpenWood evaluation set and license review.

## FreeToken fit

FlashML FreeToken is an inference engine, not a foundation model and not the unrelated commercial service at freetoken.ai. Its OpenAI-compatible surface makes it a clean adapter candidate for the writers-room lane. Its CPU/GPU mixture-of-experts offload can improve creator-owned compute economics, but it remains a young runtime with a demanding Linux/NVIDIA and host-memory envelope. OpenWood should:

1. pin a tested release, model revision, quantization, CUDA/driver combination, and prompt contract;
2. place it behind the same structured artifact parser as every other worker;
3. use a low concurrency limit and explicit timeout;
4. mark its data boundary as `local` or `private`;
5. record measured latency, throughput, failures, and output quality; and
6. keep a visible fallback route rather than disguising failure.

It should not be asked to generate or inspect final image, video, speech, music, or media masters.

## OpenWood cinematic evaluation set

Generic coding, chat, and agent benchmarks do not establish screen craft. A candidate enters production only after blinded review on versioned fixtures covering:

- first-three-second hook and ninety-second causal pacing;
- dialogue subtext, character voice, and playable behavior;
- canon recall and “who knows what when” accuracy;
- scene duration and shot-duration reconciliation;
- identity, wardrobe, prop, geography, and eyeline continuity;
- editability and deterministic structured-output validity;
- image composition and reference adherence;
- temporal coherence, motion intention, and lip/audio sync;
- voice consistency, intelligibility, and consent controls;
- music originality/similarity risk and cue usefulness; and
- rights, safety, cost, latency, failure recovery, and provenance completeness.

Preview winners do not automatically become final-quality workers. Media compute is reserved only after script, look, shot, rights, and human approval gates pass.
