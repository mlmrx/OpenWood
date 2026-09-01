# Resident company

OpenWood’s agents are credited production departments, not chatbot personalities. Each has a concrete craft remit, typed inputs and outputs, a constrained tool contract, and an acceptance gate. The canonical executable catalog lives in `lib/agents/catalog.ts`; this document explains the operating model.

| Department | Agent | Core craft | Primary deliverable |
| --- | --- | --- | --- |
| Studio | Sera Vale, Executive Producer | Audience promise, format, scope, greenlight | Creative brief, greenlight memo |
| Story | Marlowe Reed, Showrunner | Series engine, world rules, arcs, tone | Story bible, character canon |
| Story | Imani Cross, Story Architect | Hooks, causal beats, reversals, cliffhangers | Episode beat sheet |
| Writing | Noor Bishop, Screenwriter | Visual action, subtext, dialogue, timing | Structured screenplay |
| Writing | Ruth Calder, Script Editor | Logic, cliché, compression, setup/payoff | Independent coverage report |
| Direction | Aya Laurent, Director | Blocking, performance, coverage, transitions | Director treatment |
| Art | Oona Park, Production Designer | Palette, sets, wardrobe, props, visual coherence | Visual bible |
| Camera | Luca Serrin, Cinematographer | Lens grammar, light, movement, screen direction | Shot plan and storyboard specs |
| Sound | Dahlia Knox, Performance & Sound Director | Casting profile, line direction, soundscape, captions | Performance bible and cue sheet |
| Production | Kenji Moss, Asset Producer | Provider routing, seeds, retries, cost, provenance | Asset production plan and acceptance tests |
| Post | June Halden, Editor & Post Supervisor | Assembly, pacing, mix, captions, color intent | Versioned edit timeline |
| Standards | Vera Holt, Continuity Supervisor | Knowledge, props, wardrobe, time, geography, eyelines | Continuity ledger |
| Standards | Mina Okafor, Rights & Safety Producer | Licenses, consent, similarity, rating, prompt safety | Rights ledger and release blocks |
| Quality | Elias North, Independent Final Critic | Audience test, rubric, playback and technical QC | Final quality report |

## Tool contract

Agents never receive database access. Depending on their department, they may:

- read an exact approved artifact version;
- create a proposed artifact revision;
- raise or resolve an issue with evidence;
- record a typed continuity fact;
- request a media specification;
- emit progress; or
- propose—but never force—a workflow transition.

The independent critic cannot edit the work it grades. The rights producer can block release. Only the deterministic transition command can commit a legal state edge after human approval.

## Quality gates

- **Greenlight:** audience, runtime, aspect ratio, rating, originality position, boundaries, and rights declaration are explicit.
- **Bible lock:** protagonist drive/flaw, antagonist pressure, story engine, world rules, arcs, motifs, and knowledge states are specific.
- **Outline lock:** hook, causal escalation, reversal, emotional turn, cliffhanger, and runtime allocations are present.
- **Script lock:** no placeholders; every scene changes story state; dialogue, knowledge, continuity, and timing pass independent coverage.
- **Pre-production lock:** every scene has intentional coverage; shot time reconciles; visual and performance continuity are addressable.
- **Assets ready:** required files decode, meet spec, and carry hashes, provenance, and rights state.
- **Rough cut:** no gaps, impossible overlaps, clipped dialogue, missing captions, or orphaned assets.
- **Final QC:** no blockers, at least 85/100 overall, no dimension below 3/5, and playback passes.
- **Release:** immutable master manifest, checksums, cue sheet, rights ledger, captions, screenplay, and playable export are present.

OpenWood performs no hidden automatic revise loop. Each provider call produces an inspectable draft, and each retry consumes a new idempotency key and remains visible in the run ledger.
