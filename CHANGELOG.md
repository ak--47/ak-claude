# Changelog

## 0.3.0

Parity pass against the ak-gemini 2.7.0 defect sweep. A downstream consumer
audited ak-gemini and found nine defects; five of them have real analogues here,
and the pricing table had two errors of its own. Paired with ak-gemini 2.7.0.

**Minor** bump — reported token counts and `estimatedCost` change (in both
directions, to the truth) and `Transformer.send()` retry behavior changes. No
signatures removed.

### Behavior changes (read before upgrading)

- **`claude-sonnet-5` no longer jumps to $3/$15 on 2026-09-01.** The $2/$10
  launch rate was announced as introductory through 2026-08-31; Anthropic has
  since made it the standard price and cancelled the increase. It was modelled
  as an `intro` block, so from 2026-09-01 every Sonnet 5 cost estimate would
  have been 50% high — on the default model. Now flat $2/$10. **This is the
  reason to take 0.3.0 before September.**
- **`claude-opus-4-5` was priced at $15/$75; the actual rate is $5/$25.**
  Estimates for it were 3× high. Corrected, along with the dated
  `claude-opus-4-5-20250514` variant.
- **Multi-round and streaming usage numbers change, because they were wrong.**
  See "Fixed". Anything asserting exact token counts from a `ToolAgent` /
  `CodeAgent` turn will need updating.
- **`usage.attempts` on the agent classes** is now the number of API
  round-trips in the turn (was hardcoded `1`).

### Fixed

- **`stream()` reported the previous call's tokens.** Streaming methods called
  `_captureMetadata()` but never touched `_cumulativeUsage`, and
  `getLastUsage()` prefers the cumulative whenever `attempts > 0`. So a
  `stream()` after any `send()` / `chat()` on the same instance reported that
  earlier call's numbers as if fresh. Fixed in `Chat`, `RagAgent`, `ToolAgent`
  and `CodeAgent`.
- **Multi-round tool turns reported one round.** `ToolAgent.chat()`,
  `CodeAgent.chat()` and both `stream()` loops assigned usage from the FINAL
  response. Because `promptTokens` grows with accumulated history, the final
  round is the largest single call — the number looked plausible while
  undercounting the turn several-fold. Now accumulated per round.
- **`Transformer.rebuild()` skipped the `{data: …}` unwrap** that `rawSend()`
  performs. `seed()` always uses `format: 'json'`, which trains the model to
  answer in that envelope — so attempt 0 returned `payload` and attempt ≥1
  returned `{data: payload}`. With a validator that is a guaranteed
  retry-exhaustion loop. `rawSend()`, `rebuild()` and `_statelessSend()` now
  share `_parseModelResponse()`.
- **`send()` retried against the original input.** `lastPayload` only advanced
  on success, so when attempt 0 failed to PARSE, attempt 1 called
  `rebuild(ORIGINAL_INPUT, …)` — telling the model its own input was the bad
  output, double-encoded because `_preparePayload` had already stringified it.
  Extraction and validation failures are now distinguished: extraction failures
  re-send the task with a format nudge; validation failures still repair the
  payload the model actually produced.
- **`stop()` mid-round produced a malformed turn.** A `stop()` landing partway
  through `ToolAgent.stream()`'s sequential branch left `toolResults` short, and
  the partial set was still sent — Claude requires exactly one `tool_result` per
  `tool_use` block, so that was a 400. It now bails out before the send.

### Added

- Protected `BaseClaude` helpers `_resetUsage()` and `_accumulateUsage()`,
  mirroring ak-gemini's.
- `claude-opus-4-1`, `claude-opus-4`, `claude-sonnet-4` and `claude-haiku-3-5`
  in `MODEL_PRICING`. Retired on the direct API but still served on Bedrock and
  Vertex AI, which this package supports — `estimatedCost` was `null` there.
- 6 offline regression tests in `tests/consumer-fixes.test.js` (56 total).
  Full live suite also green: 388 passed across 10 files.

### Not affected (checked)

The other four ak-gemini defects do not apply here, for architectural reasons
worth recording:

- **Chunk-loop text loss / `parts[0]` truncation** — ak-claude reads
  `finalMessage.content` and iterates every block, so text and `tool_use` in the
  same response both survive.
- **Stateless paths ignoring grounding / caching** — `_sendMessage` and
  `_streamMessage` are the single param builders and both call `_buildTools()`
  and `_buildSystemParam()`, so web search and `cacheSystemPrompt` reach every
  path uniformly.
- **`useCache()` destroying the system instruction** — no cache CRUD here;
  Anthropic manages cache lifecycle server-side.

### Changed

- **`@anthropic-ai/sdk` `^0.115.0` → `^0.120.0`.** Changelog-audited across
  0.116.0–0.120.0. The removals (retired Opus 4.1 model ids, the
  `mid_conv_system` content block) touch no code here. The 0.117.0 change that
  applies all `message_delta` fields during stream accumulation makes
  `finalMessage()` usage MORE accurate, which is the same direction as the
  streaming fixes above.
- `MODEL_PRICING_AS_OF` → `2026-08-24`.

## 0.2.1

**Patch** bump — the default model changes what goes on the wire when you don't
pass `modelName` (see below). No API-surface changes. Paired with ak-gemini 2.6.1.

### Behavior changes (read before upgrading)
- **Default model is now `claude-sonnet-5`** (was `claude-sonnet-4-6`) — on every
  `BaseClaude`-derived class, `AgentQuery`, and the CLI. Pass
  `modelName: 'claude-sonnet-4-6'` to keep the old default. What the new default
  implies (all machinery shipped in 0.2.0):
  - `temperature` / `top_p` / `top_k` are dropped on the wire by the Claude
    5-family gate (Sonnet 5 returns a hard 400 on them; logged at debug).
  - Legacy `thinking: { type: 'enabled', budget_tokens: N }` is auto-translated
    to `thinking: { type: 'adaptive' }` + `output_config: { effort }`.
  - Pricing: $3/$15 per M, with the $2/$10 intro rate date-windowed through
    2026-08-31 in `MODEL_PRICING`.
  - Verified live on Vertex AI (default region `global`, served under the bare
    first-party id).

### Changed
- **`@anthropic-ai/sdk` `^0.112.2` → `^0.115.0`.** Changelog-audited: additive
  only, no breaking changes affecting the wrapper.

### Notes
- **`claude-opus-5` verified live on Vertex AI** (priced in `MODEL_PRICING`
  since 0.2.0, $5/$25 per M). It responded via the `us` multi-region endpoint;
  a freshly enabled project may 429 (`RESOURCE_EXHAUSTED`) on `global` until
  the per-base-model quota bucket is provisioned — pass `vertexRegion: 'us'`
  in the meantime.
- GUIDE model/pricing tables updated: added `claude-opus-5` and corrected the
  stale `claude-opus-4-6` ($5/$25, not $15/$75) and `claude-haiku-4-5`
  ($1/$5, not $0.80/$4) rows to match `MODEL_PRICING`.

## 0.2.0

> **Upgrading from 0.1.0?** [UPGRADING.md](./UPGRADING.md) walks through only what you
> need to change, with before/after examples.

Feature request from a downstream consumer (`smarterchild/agent`, Vertex AI).
**Minor** bump — the Claude 5-family parameter gating changes what goes on the
wire (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **Claude 5-family models no longer receive `temperature` / `top_p` / `top_k`.**
  Fable 5, Mythos 5, Opus 5, Opus 4.8, Opus 4.7, and Sonnet 5 return a hard 400
  on any of these. ak-claude now drops them (one `log.debug` naming the dropped
  keys) instead of failing the call. Pre-5 models are unaffected. Previously
  these models were unusable without monkey-patching `BaseClaude`.
- **`thinking: { type: 'enabled', budget_tokens: N }` is translated on the
  Claude 5 family.** That shape also 400s there. It now becomes
  `thinking: { type: 'adaptive' }` + `output_config: { effort }` using the
  mapping below (logged at debug). Opus 4.6 / Sonnet 4.6 keep the legacy shape
  by default — opt in with `adaptiveThinking: true` (this is what silences
  Anthropic's `budget_tokens` deprecation warning). The default flips in the
  next major.

  | `budget_tokens` | effort |
  |---|---|
  | `0` / falsy | thinking omitted entirely |
  | 1–2048 | `low` |
  | 2049–8192 | `medium` |
  | 8193–24576 | `high` |
  | > 24576 | `xhigh` |

- **`temperature: null` / `topP: null` / `topK: null` now mean "never send".**
  Previously `null` collapsed into the default (`temperature` → `0.7`).
  `undefined` still means "use the default".
- **`top_k` is now suppressed whenever thinking is active**, matching
  `temperature`/`top_p`. It previously escaped the guard in `Chat`, `ToolAgent`,
  `CodeAgent`, and `RagAgent` (but not `Message`/`Transformer`) — the same config
  produced different wire params depending on which class you used.
- **`gemini`-style tool declarations with no parameter schema now throw at
  construction.** `ToolAgent` previously forwarded `input_schema: undefined` to
  the API, producing an opaque 400. For a no-argument tool pass
  `{ type: 'object', properties: {} }`.

### Added
- **`effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`** on every class. Sets
  `thinking: { type: 'adaptive' }` + `output_config: { effort }`. Same option
  name as ak-gemini (which maps it to `thinkingConfig.thinkingLevel`).
  `xhigh` is not valid on Opus 4.6 / Sonnet 4.6 and clamps to `high` with a
  warning. An unrecognized level throws at construction.
- **`adaptiveThinking: boolean`** — opt in to `budget_tokens` → adaptive
  translation on the 4.6 family (default `false`).
- **`cacheTtl: '5m' | '1h'`** — emits `cache_control: { type: 'ephemeral', ttl }`
  and bills cache writes correctly: **1.25× input at 5m, 2× at 1h.**
  `computeCost(..., { cacheTtl: '1h' })` exposes the same knob.
- **`thinking.display`** (`'omitted'` default on the 5 family, `'summarized'`
  opt-in) passes through verbatim on both the adaptive and translated paths.
- **Pricing for the current flagships:** `claude-opus-5`, `claude-mythos-5`,
  `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`.
  `claude-opus-5` was previously absent from `MODEL_PRICING` *and* unmatched by
  the family regex, so cost came back `null` on the flagship model.
- **Sonnet 5 introductory pricing** ($2/$10 per M through 2026-08-31, then
  $3/$15) via a date-windowed table entry. `resolvePricing(id, { at })` and
  `computeCost(..., { at })` accept an explicit date for back-dated reporting.
- **New exports:** `MODEL_PRICING_AS_OF`, `EFFORT_LEVELS`, `budgetTokensToEffort()`.
  `resolvePricing()` now returns `asOf` (and `introUntil` inside an intro window).
- **Legible Vertex 403s.** A `403` on a `fable`/`mythos` model is rethrown with
  the `gcloud beta services vertex-ai publisher-models set-publisher-model-config`
  command needed to enable publisher data sharing (original error preserved on
  `.cause`).

### Fixed
- Sampling and thinking params are now built by two shared `BaseClaude` methods
  (`_applySamplingParams` / `_applyThinkingParams`) called from all five call
  sites (`_sendMessage`, `_streamMessage`, `Message`, `Transformer._statelessSend`,
  `cli.js`). These four had drifted apart.
- `_applyThinkingParams` **merges** into an existing `output_config` rather than
  replacing it, so `responseSchema` (`output_config.format`) and `effort` coexist.
- **`getLastUsage()` now reports cache tokens.** `Chat`, `ToolAgent`, `CodeAgent`,
  `RagAgent`, and `Transformer` seeded `_cumulativeUsage` without
  `cacheCreationTokens` / `cacheReadTokens`, and `Transformer` did not accumulate
  them across validation retries — so a retried transform reported cumulative
  prompt tokens alongside last-call cache tokens, understating `estimatedCost`.
  Per-call `result.usage` was already correct.

### Notes
- **Sonnet 5 uses a new tokenizer that produces roughly 30% more tokens** than
  Sonnet 4.6 for the same text. This affects cost projections, `maxTokens`
  sizing, and any upstream chunker. `estimate()` calls `countTokens()` and is
  accurate; the local character heuristics are not.
- `null` from `resolvePricing()` / `usage.estimatedCost` means the model's
  pricing is **unknown** — it does not mean the call was free.

## 0.1.0

Fixes from a downstream consumer's adversarial review. **Minor** bump — includes
behavior changes (see "Behavior changes" below).

### Behavior changes (read before upgrading)
- **Vertex default region `us-east5` → `global`.** Existing Vertex consumers with
  no explicit `vertexRegion`/`GOOGLE_CLOUD_LOCATION` are re-routed to the global
  endpoint on upgrade. `global` serves the Claude 5-family, routes dynamically,
  and carries no 10% regional premium. **If you require data residency, VPC-SC, or
  regional provisioned throughput, set `vertexRegion` (or `GOOGLE_CLOUD_LOCATION`)
  explicitly.** Precedence: option > env > `global`. The resolved region is logged
  at debug; a warning fires when a Claude 5-family model is paired with a specific
  regional endpoint.
- **`Message` Vertex structured output is now validated.** Previously any
  parseable JSON came back as `result.data`. On the Vertex prompt-paste fallback,
  output is now validated against `responseSchema`; on failure it retries with
  error feedback (`validationRetries`, default 2) and then returns
  `data: null` + `result.validationErrors` — never a schema-invalid object. To
  restore return-what-parsed behavior, set `validationMode: 'warn'` (returns the
  parsed data plus `validationErrors`). `validationRetries: 0` disables retries.
- **`Message.result.usage.promptTokens`/`responseTokens` are cumulative across
  retry attempts** on the Vertex fallback path (were per-call). Up to 3 API calls
  per `send()` by default on that path (`validationRetries: 2`).

### Added
- **`usage.estimatedCost`** — every `send()` result and `getLastUsage()` include
  an estimated USD cost from `MODEL_PRICING` (`null` when unpriced). Includes
  Anthropic cache-token billing (cache-write 1.25× input, cache-read 0.1× input).
- **Concurrency-safe per-call usage.** `Message.send()` returns `result.usage`
  computed synchronously from that call's own response(s). `getLastUsage()` still
  reflects the instance's last call and is unsafe across concurrent sends — use
  `result.usage`.
- **`Message` options:** `validationMode: 'strict' | 'warn'`,
  `vertexNativeStructuredOutput` (opt in to native `output_config` on Vertex —
  GA but gated by the org policy `constraints/vertexai.allowedPartnerModelFeatures`).
- **Pricing helpers exported:** `MODEL_PRICING`, `resolvePricing()`,
  `computeCost()`. `resolvePricing` resolves Vertex `@YYYYMMDD` and hyphen-dated
  snapshots to bare-id pricing.
- **`validateSchema()`** JSON-Schema validator exported (`type`/`required`/
  `properties`/`additionalProperties`/`items`/`enum`/`nullable`; other keywords
  are pass-through).

### Fixed
- `estimateCost()` now uses `resolvePricing()` and returns `null` cost fields for
  unknown models (was `0`).
- Bare `claude-opus-4-5` / `claude-sonnet-4-5` ids now resolve pricing.
- `estimatedCost` no longer returns `null` for a priced model when the API echoes
  a date-suffixed build id.
- `Message` on Vertex no longer sends `temperature` + `top_p` together (Vertex
  rejects the pair) — prefers `temperature`, matching the base class.

### Dependencies
- `@anthropic-ai/sdk` `^0.110.0` → `^0.112.2` (no breaking changes to the used
  surface). `@anthropic-ai/vertex-sdk` remains `^0.19.0` (already latest).
