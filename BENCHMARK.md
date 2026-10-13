# Model Benchmark

Two tasks, six models, same prompts across the board. Five models ran the code understanding task; six ran the HTML generation task.

---

## Task 1 — Code Understanding

**Prompt:** Explain what the code does, walk through a practical example, flag bugs, keep it concise and conversational.  
**Codes tested:** `NewsCache` (67 lines) and `JobQueue` (227 lines).

| Model | Bugs Found | Clarity | Length | Standout |
|---|---|---|---|---|
| GPT-5.6 Luna | Most (7 on code2) | ★★★★★ | Short | Caught priority starvation + shared-object mutation — unique finds |
| Grok 4.6 | Many (6 on code2) | ★★★★★ | Medium | Best use of metaphor; noted at-least-once delivery semantics |
| Composer 2.5 | Many (5 on code2) | ★★★★★ | Medium | Cleanest structure; caught the synchronous-throw edge case |
| Gemini 3.6 Flash | Good (4 on code2) | ★★★☆☆ | Long | Deepest on scale issues; ignored the "concise" instruction |
| Muse Spark 1.3 | Fewer (4 on code2) | ★★★★☆ | Shortest | Easiest to skim; too shallow for complex code |

**Winner: GPT-5.6 Luna** — most complete, best prose, unique insights.

---

## Task 2 — Zero-Shot HTML Generation

**Prompt:** Build a cinematic, single-file mission-control interface for a fictional deep-space agency. No frameworks, no external assets.

| Model | Size | Lines | Visual Quality | Completeness |
|---|---|---|---|---|
| Gemini 3.6 Flash | 81 KB | 2 184 | ★★★★★ | Highest — full design system, rich SVG, every section covered |
| Grok 4.7 | 53 KB | 1 287 | ★★★★☆ | Feature-complete; cinematic atmosphere |
| GPT-5.6 Luna | 41 KB | 1 080 | ★★★★☆ | Polished and readable; strong interaction model |
| Composer 2.5 | 35 KB | 1 069 | ★★★★☆ | Tasteful and restrained; may under-deliver on spectacle |
| Gemini 2.5 Flash | 16 KB | 385 | ★★☆☆☆ | Bare minimum; likely skips required sections |

**Winner: Gemini 3.6 Flash** — most complete and visually rich output.

---

## Pros & Cons

### GPT-5.6 Luna
- ✅ Most thorough bug analysis; catches design-level issues
- ✅ Clearest, most natural writing
- ❌ Less visual/structured than other models; no code examples in fixes

### Grok 4.6 / 4.7
- ✅ Best narrative voice — metaphors make complex systems click
- ✅ Flags high-level design gaps, not just bugs
- ❌ Fix suggestions are sometimes too brief

### Composer 2.5
- ✅ Well-structured with tables, diagrams, and summaries
- ✅ Actionable fix suggestions
- ❌ Slightly over-formatted for a conversational prompt

### Gemini 3.6 Flash
- ✅ Most exhaustive output in both tasks
- ✅ Strong on operational and scale concerns
- ❌ Routinely too long; hard to skim

### Gemini 2.5 Flash
- ✅ Fast; smallest footprint
- ❌ Trades capability for speed — weaker on both tasks

### Muse Spark 1.3
- ✅ Most scannable; great for a quick mental model
- ❌ Misses bugs and depth on more complex code

---

## Quick Pick

| Need | Use |
|---|---|
| Deep code review | GPT-5.6 Luna |
| Explaining to someone else | Grok |
| Rich UI generation | Gemini 3.6 Flash |
| Fast prototype | Gemini 2.5 Flash |
| Quick orientation | Muse Spark |

---

*Analysis by Claude Sonnet 4.6*
