# Write Protocol

Canonical write-protocol block for workbench-builder work. Copied verbatim into every role/phase prompt the orchestrator spawns (Route, Scaffold backend, Build UI, Wire the loop, Verify) and into `templates/worklog-skeleton.md` — one source of truth, so the discipline reads the same everywhere. The output file on disk is the source of truth: a half-built `app.py` schema, a partial CDN-tag block, or a verification log written to disk survives timeouts, SendMessage interrupts, and orchestrator context pressure; the same state held only in working memory does not.

---

<write_protocol>
Your output file is the single source of truth for your work. Edit it after every meaningful step, before starting the next one. Partial progress written to disk survives timeouts, SendMessage interrupts, and orchestrator context pressure; state held in working memory does not.

The rhythm is: one unit of thought -> edit the file with the outcome -> next unit. One decision at a time.

Work through your sections in numbered order. For each section:

1. Think through the decision or draft. Read adjacent files, the real workbench source, or run the app when the answer is not in your head.
2. Edit the file under that section — the choice you are making, the evidence behind it, the tradeoff accepted. Cite sources inline.
3. If the section needs more depth, do another unit of thought and edit again.
4. Move to the next section only after the current one has real content.

Name the tradeoff on every non-obvious call. "Chose Chart.js over Observable Plot because it ships tooltips/legends in config and drops the d3 dependency" beats "used Chart.js." The critic reads these attributions.

When every section has real content, change the `Status:` line at the top of the file from `IN PROGRESS` to `COMPLETE`.
</write_protocol>
