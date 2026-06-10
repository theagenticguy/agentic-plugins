# Description Rewriting Patterns

Specific patterns for rewriting skill descriptions to resolve router collisions. Complements the broader `meta-prompt-optimizer` skill — scope here is descriptions only.

## Contents

- Pattern 1: Add a negative discriminator
- Pattern 2: Narrow the trigger noun phrase
- Pattern 3: State the sub-worker relationship
- Pattern 4: Name the domain, not the verb
- Pattern 5: Compose the rewrite with three required elements
- Pattern 6: The 1,024 / 1,536 caps
- What NOT to do

## Pattern 1: Add a negative discriminator

When two skills overlap on a common verb ("create a diagram", "build an agent"), add a negative clause that points at the sibling.

**Before:**

```text
mermaid-diagrams: Creates Mermaid diagrams for architecture, flowcharts, and sequence diagrams. Use when the user asks to draw a diagram.
```

**After:**

```text
mermaid-diagrams: Creates Mermaid diagrams for architecture, flowcharts, and sequence diagrams. Use when the user asks to draw a diagram with Mermaid syntax. Do NOT use when the user wants pixel-perfect AWS architecture diagrams — use drawio-diagrams with its AWS reference instead.
```

---

## Pattern 2: Narrow the trigger noun phrase

Replace a generic verb with a specific noun phrase the sibling doesn't share.

**Before:**

```text
research: Researches topics.
```

**After:**

```text
research: Multi-agent external-web research with parallel Opus workers and a synthesis pass. Use when the user asks to research a topic, find comparisons, or learn about a technology on the public web.
```

---

## Pattern 3: State the sub-worker relationship

When one skill is a sub-component of another (called only from a parent orchestrator), say so explicitly and add the proactive disclaimer.

**Before:**

```text
design-critic: Reviews slide designs.
```

**After:**

```text
design-critic: Reviews visual design of a Slidev presentation against the AWS brand system. Does NOT trigger proactively — use only when the user explicitly asks to review slide design or when invoked by the craft-presentation orchestrator.
```

---

## Pattern 4: Name the domain, not the verb

Swap a generic verb ("analyze", "review", "build") for a domain-specific one the sibling doesn't match.

**Before:**

```text
prompt-critic: Reviews prompts.
```

**After:**

```text
prompt-critic: Scores prompts against the current Claude instruction-following rubric. Does NOT rewrite — use meta-prompt-optimizer for rewrites. Does NOT trigger proactively.
```

---

## Pattern 5: Compose the rewrite with three required elements

Every collision-fix rewrite must end with:

1. The `Use when the user asks to <verb>` clause — keeps routing predictable.
2. A `Do NOT use when <sibling-domain>` clause for every sibling it collides with.
3. Motivation for the distinction if it's non-obvious, in ≤ 1 sentence.

This turns a collision into two distinct router slots.

---

## Pattern 6: The 1,024 / 1,536 caps

Anthropic's hard caps:

- `description` field alone: 1,024 characters.
- `description` + `when_to_use` combined (what the router sees): 1,536 characters.

If the rewrite pushes past these, trim the most generic sentence first. Keep the verb phrase and the negative discriminator; drop redundant positive framing.

---

## What NOT to do

- **Don't swap verbs for synonyms.** "Creates diagrams" → "Builds diagrams" doesn't help the router; they embed to nearly the same vector.
- **Don't add decorative keywords at the end.** Keyword stuffing bloats the description without improving trigger precision; it also pushes past the 1,536 cap faster.
- **Don't add `use proactively` to resolve a collision.** That raises the trigger volume, not the specificity. Use negative discriminators instead.
- **Don't make the description less informative to the user.** Router readability and user readability are the same text. A description that's optimized against a sibling but confuses a human reading `/help` failed.
