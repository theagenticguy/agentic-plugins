# Description Rewrite Proposal

**Status:** IN PROGRESS
**Generated:** {{ timestamp }}
**Collision pair:** {{ skill_a }} ↔ {{ skill_b }}
**Cosine (from last audit):** {{ cosine }}

---

## {{ skill_a }}

**File:** `{{ path_a }}/SKILL.md`

### Before

```yaml
description: >
  {{ original_description_a }}
```

### After

```yaml
description: >
  {{ proposed_description_a }}
```

### Changelog

- {{ change 1 }}
- {{ change 2 }}

### Character check

- `description` length: {{ n }} / 1,024
- Combined with `when_to_use`: {{ n }} / 1,536

---

## {{ skill_b }}

**File:** `{{ path_b }}/SKILL.md`

### Before

```yaml
description: >
  {{ original_description_b }}
```

### After

```yaml
description: >
  {{ proposed_description_b }}
```

### Changelog

- {{ change 1 }}
- {{ change 2 }}

### Character check

- `description` length: {{ n }} / 1,024
- Combined with `when_to_use`: {{ n }} / 1,536

---

## Apply

1. Copy the **After** block into each SKILL.md's frontmatter.
2. Run `dprint fmt` and `markdownlint-cli2` to verify.
3. Re-score both skills with `/audit-skill`.
4. Re-run embeddings (next monthly `/gardener` pass) to confirm cosine drops below 0.85.
