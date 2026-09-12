# OpenWood storyworld protocol

OpenWood’s “infinite drama” is an evolving, resumable storyworld—not endless autoplay and not an unbounded generation bill. The durable unit is a versioned canon event with authored consequences. Models can change; the world’s history, audience promises, rights, and creative decisions remain legible.

## What ships now: Story Doors v1

A Story Door is an approved `participation-manifest` artifact attached to a production. It opens at an authored time or at the end of an episode and offers two to four dramatically distinct pressures. Every option must name its cost. Every prompt must name the payoff the showrunner is promising.

```json
{
  "schema": "openwood.participation/v1",
  "prompts": [{
    "id": "episode-01-door",
    "episode": 1,
    "trigger": { "kind": "time", "atSeconds": 86 },
    "mode": "prediction",
    "question": "What should Mara risk next?",
    "context": "The future broadcast named Elias, but the only proof lives inside the impossible signal.",
    "options": [{
      "id": "trace-signal",
      "label": "Trace the impossible signal",
      "dramaticCost": "It may reveal Mara's location to whoever is transmitting."
    }],
    "binding": "advisory",
    "promise": "The showrunner will address the audience's chosen pressure in Episode 2.",
    "status": "open"
  }]
}
```

Protocol rules:

- The participation manifest must be approved or locked before it is public.
- A signal is tied to project, manifest artifact ID, manifest version, prompt ID, option ID, and an anonymous viewer key. The key is an HMAC of a dedicated HttpOnly audience token scoped by the project and exact manifest version; the raw token is never stored and stored keys cannot be joined across storyworlds.
- The same viewer may change a signal while the Story Door is open; the aggregate changes rather than duplicating that viewer.
- Every changed or created signal consumes an atomic, configurable per-storyworld 60-second attempt budget, and choice changes have a short per-viewer cooldown. Idempotent repeats do not consume the budget. This application-layer control stores no IP address or browser fingerprint; public deployments should additionally use an edge rate limiter against distributed abuse.
- The exact dramatic prompt and payoff promise remain immutable in the release manifest. An owner-only operational record may close or reopen signaling for that exact version without rewriting its authored history.
- Public percentages and totals appear only after that viewer participates. Zero data remains zero; the product never invents activity.
- `binding` is `advisory` in v1. The showrunner retains final cut and must resolve the published payoff contract in a later episode or explicitly explain why it changed.
- Viewing, playback, export, and production remain available without an account.

Every public demo or released production also exposes `GET /api/worlds/:slug` as `application/openwood+json`. The response deliberately includes public episode identity, theater and participation links, the exact approved prompt contract, and its effective open/closed state while excluding private production notes, issues, asset-vault records, provider details, audience-signal rows, cookies, and credentials. Theater clients request the current episode explicitly; a prompt authored for another episode never leaks into the current screening.

## Engagement compact

The product optimizes for four durable reasons to return:

1. **Anticipation:** each episode leaves a precise dramatic question.
2. **Authorship:** a viewer can express what pressure the story should explore.
3. **Belonging:** measured audience pulse reveals how that choice compares after participation.
4. **Payoff:** the next release visibly answers the earlier promise.

OpenWood does not use streak loss, fake scarcity, fabricated counts, forced autoplay, disguised advertisements, or punitive notifications. Engagement should survive informed consent.

## Portable storyworld roadmap

The next protocol layers are intentionally not represented as shipped:

- `openwood.canon-event/v1`: append-only facts, actions, knowledge changes, rights state, and source artifact hashes.
- `openwood.worldline/v1`: a named branch with a parent event and an explicit relationship to showrunner canon.
- `openwood.canon-decision/v1`: a signed editorial decision that accepts, adapts, or rejects audience pressure with rationale.
- `openwood.episode-release/v1`: immutable episode package, participation payoff references, playback manifest, and model/media provenance.
- Signed canon-event and release export so a storyworld can move between compatible hosts without losing canon or credits.

That roadmap supports an open network of independently hosted storyworlds. It does not require one centralized recommendation feed, one model vendor, or one identity provider.
