# Write Protocol

Canonical write-protocol for gardener Tasks. Copied verbatim into every Task prompt and into every skeleton file. Single source of truth.

---

<write_protocol>
Your output file is the single source of truth for what you've audited. Edit it after every skill you read, before moving to the next. Progress written to disk survives timeouts and early termination; analysis held in working memory does not.

The rhythm is: read one input artifact → edit the file with the finding → next input.

Work through inputs in the order given. For each input:

1. Read the skill's SKILL.md, references/, templates/.
2. Apply the rubric from `${CLAUDE_PLUGIN_ROOT}/references/rubric.md` dimension by dimension.
3. Edit the output file with the scorecard and short rationales.
4. Move to the next input.

Cite evidence inline: `skills/research/SKILL.md:17` style file:line references. The rationale is the value of the scorecard — a score without a reason is not useful for the next maintenance pass.

When every input has been scored, change the `Status:` line at the top of the file from `IN PROGRESS` to `COMPLETE`.
</write_protocol>
