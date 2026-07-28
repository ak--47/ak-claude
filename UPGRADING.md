# Upgrading ak-claude

Per-version upgrade notes. For the full list of changes see [CHANGELOG.md](./CHANGELOG.md).

---

## 0.1.0 → 0.2.0

**Minor bump, but three things change on the wire.** Read the "Action required" boxes below — everything else is additive.

This release exists because ak-claude 0.1.0 could not talk to the Claude 5 family at all. If you are on `claude-sonnet-4-6` or older and not using extended thinking, you can upgrade without touching your code.

### At a glance

| If you… | Then… |
|---|---|
| use `claude-sonnet-4-6`, `claude-opus-4-6`, or `claude-haiku-4-5` with no `thinking` | nothing to do |
| use any Claude 5-family model | your `temperature` / `topP` / `topK` are now dropped instead of 400ing — see #1 |
| pass `thinking: { type: 'enabled', budget_tokens: N }` | translated automatically on Claude 5; unchanged on 4.6 — see #2 |
| monkey-patched `BaseClaude` to strip sampling params | **delete the patch** — see #1 |
| pass `temperature: null` (or `topP` / `topK`) | `null` now means "never send" rather than "use the default" — see #3 |
| declare tools without a parameter schema | now throws at construction — see #4 |
| read `getLastUsage()` on a model with no pricing entry | unchanged: `estimatedCost` is `null`, which means **unknown, not free** |

---

### 1. Claude 5-family models no longer receive sampling params

**Affects:** `claude-fable-5`, `claude-mythos-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`.

These models return a hard `400` on `temperature`, `top_p`, or `top_k`. ak-claude sent `temperature: 0.7` by default, so **every call to these models failed** in 0.1.0. They now get dropped before the request, with one `log.debug` naming the dropped keys.

```js
// This worked in neither 0.1.0 nor before — it now just works.
const chat = new Chat({ modelName: 'claude-sonnet-5', temperature: 0.7 });
await chat.send('hi');   // 0.1.0: 400 Bad Request.  0.2.0: fine, temperature dropped.
```

> **Action required if you monkey-patched.** If you subclassed or patched `BaseClaude` to strip these params yourself, remove the patch. The internal param construction moved into two methods (`_applySamplingParams` / `_applyThinkingParams`) and a patch written against 0.1.0's inline blocks will either no-op or double-apply.

Pre-Claude-5 models are unaffected and still receive `temperature` / `top_p` / `top_k` exactly as before.

`claude-opus-5` in particular was missing from both the family regex *and* `MODEL_PRICING` in 0.1.0, so it 400'd on every call and reported `estimatedCost: null`. Both are fixed.

### 2. `budget_tokens` is translated to adaptive thinking

The legacy shape also 400s on the Claude 5 family. It is now translated:

```js
// What you write (still supported):
new Chat({ modelName: 'claude-sonnet-5', thinking: { type: 'enabled', budget_tokens: 10000 } })

// What goes on the wire:
{ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
```

| `budget_tokens` | effort |
|---|---|
| `0` / falsy | thinking omitted entirely |
| 1–2048 | `low` |
| 2049–8192 | `medium` |
| 8193–24576 | `high` |
| > 24576 | `xhigh` |

Exported as `budgetTokensToEffort(n)` if you want to compute the mapping yourself.

**Opus 4.6 / Sonnet 4.6 keep the legacy shape by default.** They still accept `budget_tokens`, but Anthropic emits a deprecation warning for it. Opt into translation to silence that warning:

```js
new Chat({ modelName: 'claude-sonnet-4-6', thinking: { type: 'enabled', budget_tokens: 10000 }, adaptiveThinking: true })
```

This default flips in the next major.

**Preferred going forward** — skip `thinking` entirely and use `effort`:

```js
new Chat({ modelName: 'claude-sonnet-5', effort: 'high' })
```

`effort` accepts `'low' | 'medium' | 'high' | 'xhigh' | 'max'`, and is the same option name in ak-gemini. An unrecognized value **throws at construction** rather than failing later as a 400. `xhigh` is not valid on the 4.6 family and clamps to `high` with a warning.

### 3. `null` sampling params now mean "never send"

```js
new Chat({ temperature: null })
// 0.1.0: null collapsed into the default → temperature: 0.7 was sent
// 0.2.0: temperature is not sent at all
```

`undefined` still means "use the default". Only change anything if you were passing an explicit `null` and relying on it behaving like `undefined`.

Related: `top_k` is now suppressed whenever thinking is active, matching `temperature` / `top_p`. In 0.1.0 it escaped that guard in `Chat`, `ToolAgent`, `CodeAgent`, and `RagAgent` but not `Message` / `Transformer` — so the same config produced different wire params depending on which class you used.

### 4. Tools must declare a parameter schema

`ToolAgent` used to forward `input_schema: undefined` to the API, producing an opaque 400. It now throws at construction naming the offending tool.

```js
// Now throws:
new ToolAgent({ tools: [{ name: 'ping', description: 'ping' }] })

// Fix — a no-argument tool still needs an empty object schema:
new ToolAgent({ tools: [{ name: 'ping', description: 'ping', input_schema: { type: 'object', properties: {} } }] })
```

### 5. Cost reporting is more accurate (no action needed)

- Pricing added for `claude-opus-5`, `claude-mythos-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-5`.
- **Sonnet 5 introductory pricing** ($2/$10 per M through 2026-08-31, then $3/$15) resolves by date. Pass `{ at }` to back-date a report:
  ```js
  resolvePricing('claude-sonnet-5', { at: '2026-09-15' })   // → 3.00 / 15.00
  ```
- **Cache tokens are now priced.** Anthropic *excludes* cache tokens from `input_tokens`, so writes and reads are billed **on top**: writes at 1.25× input at the default 5-minute TTL, **2× at 1 hour**, reads at 0.1×. Set `cacheTtl: '1h'` to get both the `ttl` on the wire and the correct multiplier.
- `getLastUsage()` now reports cache tokens on `Chat`, `ToolAgent`, `CodeAgent`, `RagAgent`, and `Transformer`. These previously dropped `cacheCreationTokens` / `cacheReadTokens` from cumulative usage, and `Transformer` did not accumulate them across validation retries — so a retried transform reported cumulative prompt tokens next to last-call cache tokens. Per-call `result.usage` was already correct.

> **Sonnet 5 uses a new tokenizer that produces roughly 30% more tokens than Sonnet 4.6 for the same text.** Recheck cost projections, `maxTokens` sizing, and any upstream chunker before switching. `estimate()` calls `countTokens()` and stays accurate; local character-count heuristics do not.

### New exports

```js
import {
  MODEL_PRICING_AS_OF,     // date the pricing table was last verified
  EFFORT_LEVELS,           // ['low','medium','high','xhigh','max']
  budgetTokensToEffort,    // (n) => 'low'|'medium'|'high'|'xhigh'|null
  resolvePricing,          // now returns `asOf`, and `introUntil` inside an intro window
  computeCost              // now takes (model, in, out, cacheWrite, cacheRead, { at, cacheTtl })
} from 'ak-claude';
```

`resolvePricing()` and `computeCost()` keep their old call signatures — the new arguments are optional and trailing.

### Vertex AI notes

- The Claude 5 family requires a `global`, `us`, or `eu` endpoint. Specific regional endpoints (e.g. `us-east5`) serve Sonnet 4.6 and earlier only, and 404 on the newer models. ak-claude defaults `vertexRegion` to `global`.
- A `403` on a `fable` / `mythos` model is now rethrown with the `gcloud beta services vertex-ai publisher-models set-publisher-model-config` command needed to enable publisher data sharing. The original error is preserved on `.cause`.
