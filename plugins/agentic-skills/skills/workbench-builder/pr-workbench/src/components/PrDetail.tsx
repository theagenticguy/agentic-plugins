import { useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type Overlap,
  type PrDetail as Detail,
  RISK_BADGE,
  SEVERITY_BADGE,
  STATE_BADGE,
} from "../types";
import { post, useRegion } from "../useRegion";
import { Churn } from "./Churn";
import { Path } from "./Path";

/** Groups the self-join rows by path so the reader sees one line per contested
 *  file rather than the raw cross product. */
function groupOverlap(rows: Overlap[]): Array<{ path: string; others: Overlap[] }> {
  const byPath = new Map<string, Overlap[]>();
  for (const r of rows) {
    const list = byPath.get(r.path);
    if (list) list.push(r);
    else byPath.set(r.path, [r]);
  }
  return [...byPath.entries()].map(([path, others]) => ({ path, others }));
}

function AskAboutPr({ prId }: { readonly prId: number }) {
  const [draft, setDraft] = useState("");
  const ask = async () => {
    if (draft.trim() === "") return;
    await post("/api/ask", { body: draft.trim(), kind: "investigate", pr_id: prId });
    setDraft("");
  };
  return (
    <VStack gap={1}>
      <TextArea
        label="Ask the agent about this PR"
        isLabelHidden
        placeholder="Ask the agent about this PR…"
        rows={2}
        value={draft}
        changeAction={(v) => setDraft(v)}
      />
      <HStack gap={1}>
        <Button
          size="sm"
          label="Ask"
          data-testid="pr-ask-submit"
          onClick={ask}
          isDisabled={draft.trim() === ""}
        />
      </HStack>
    </VStack>
  );
}

/**
 * Per-PR detail, subscribed to the parameterized region `pr-<id>`.
 *
 * Because it is a region and not a one-shot GET, a terminal re-ingest of this
 * PR repaints the open dialog through the same `publish()` fan-out as every
 * other panel — no bespoke refetch wiring, and the reconnect heal in
 * `useRegion` covers it too.
 */
export function PrDetailDialog({
  prId,
  onClose,
}: {
  readonly prId: number;
  readonly onClose: () => void;
}) {
  const detail = useRegion<Detail>(`pr-${prId}`);

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      // purpose="form" — the dialog carries an ask textarea, and a backdrop
      // click discarding a half-typed question is the worst kind of data loss.
      purpose="form"
      width={760}
      maxHeight="86vh"
      // The DialogHeader that names this dialog only exists once the region has
      // resolved, so the loading frame needs its own name. Dropping the prop
      // once `detail` lands hands naming back to the header title, which says
      // which PR is open.
      aria-label={detail === null ? "Pull request detail, loading" : undefined}
    >
      {detail === null ? (
        <VStack gap={2} padding={4}>
          <Text type="supporting">loading PR…</Text>
        </VStack>
      ) : (
        <>
          <DialogHeader
            title={`#${detail.pr.number} ${detail.pr.title}`}
            subtitle={`${detail.pr.author} · ${detail.pr.branch}`}
            onOpenChange={(open) => {
              if (!open) onClose();
            }}
            hasDivider
          />
          {/* minWidth:0 on the scroll body: the summary renders GFM tables and
              fenced code, which expand past the dialog without it. */}
          <VStack
            gap={2}
            padding={4}
            data-testid="pr-detail"
            style={{ minWidth: 0, overflowY: "auto" }}
          >
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Badge variant={RISK_BADGE[detail.pr.risk]} label={`${detail.pr.risk} risk`} />
              <Badge variant={STATE_BADGE[detail.pr.state]} label={detail.pr.state} />
              <Churn additions={detail.pr.additions} deletions={detail.pr.deletions} />
            </HStack>

            <HStack gap={1} wrap="wrap">
              {(["open", "draft", "changes", "approved"] as const)
                .filter((s) => s !== detail.pr.state)
                .map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="ghost"
                    label={`mark ${s}`}
                    onClick={() => post(`/api/prs/${detail.pr.id}/state`, { state: s })}
                  />
                ))}
            </HStack>

            <Divider />

            {/* The markdown path: Astryx Markdown renders GFM tables, nested
                lists, and highlighted fences as an element tree — no
                innerHTML, no sanitizer. DialogHeader's title is an h2, so
                headingLevelStart={3} continues the outline without skipping a
                level. */}
            <div style={{ minWidth: 0 }} data-testid="pr-summary">
              <Markdown headingLevelStart={3} density="compact" contentWidth="100%">
                {detail.pr.summary}
              </Markdown>
            </div>

            <Divider />

            <Collapsible trigger={`Files (${detail.files.length})`} defaultIsOpen>
              <VStack gap={1} data-testid="pr-files" style={{ minWidth: 0 }}>
                {detail.files.map((f) => {
                  const maxFile = Math.max(
                    ...detail.files.map((x) => x.additions + x.deletions),
                    1,
                  );
                  return (
                    <HStack key={f.id} gap={2} vAlign="center" wrap="wrap">
                      <Churn
                        additions={f.additions}
                        deletions={f.deletions}
                        max={maxFile}
                        width={90}
                      />
                      <Path>{f.path}</Path>
                      {f.kind !== "modified" && (
                        <Text type="supporting">{f.kind}</Text>
                      )}
                    </HStack>
                  );
                })}
              </VStack>
            </Collapsible>

            <Collapsible trigger={`Concerns (${detail.concerns.length})`} defaultIsOpen>
              <VStack gap={1.5} data-testid="pr-concerns" style={{ minWidth: 0 }}>
                {detail.concerns.length === 0 && (
                  <Text type="supporting">No concerns recorded.</Text>
                )}
                {detail.concerns.map((c) => (
                  <Card key={c.id} variant="muted" padding={2}>
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Badge variant={SEVERITY_BADGE[c.severity]} label={c.severity} />
                        <Text weight="semibold" hasStrikethrough={c.resolved === 1}>
                          {c.title}
                        </Text>
                      </HStack>
                      {c.path !== "" && <Path color="secondary">{c.path}</Path>}
                      {c.body !== "" && <Text color="secondary">{c.body}</Text>}
                      <HStack gap={1}>
                        {/* Every concern card offers the same two words, so the
                            visible label cannot say which concern it toggles. */}
                        <Button
                          size="sm"
                          variant="ghost"
                          label={c.resolved === 1 ? "reopen" : "resolve"}
                          aria-label={`${c.resolved === 1 ? "Reopen" : "Resolve"} concern: ${c.title}`}
                          onClick={() =>
                            post(`/api/concerns/${c.id}/resolved`, {
                              resolved: c.resolved !== 1,
                            })
                          }
                        />
                      </HStack>
                    </VStack>
                  </Card>
                ))}
              </VStack>
            </Collapsible>

            {/* The complementary self-join: "who else touches my files." The
                collisions rail answers this for the whole set; this answers it
                for the PR you are actually reading. */}
            <Collapsible
              trigger={`Also touches my files (${groupOverlap(detail.overlap).length})`}
              defaultIsOpen
            >
              <VStack gap={1} data-testid="pr-overlap" style={{ minWidth: 0 }}>
                {detail.overlap.length === 0 && (
                  <Text type="supporting">
                    No other PR in the set touches these files.
                  </Text>
                )}
                {groupOverlap(detail.overlap).map(({ path, others }) => (
                  <HStack key={path} gap={2} vAlign="center" wrap="wrap">
                    <Path>{path}</Path>
                    {others.map((o) => (
                      <Badge
                        key={o.number}
                        variant={RISK_BADGE[o.risk]}
                        label={`#${o.number} +−${o.their_churn}`}
                      />
                    ))}
                  </HStack>
                ))}
              </VStack>
            </Collapsible>

            <Divider />

            <VStack gap={1}>
              {/* level={3} — DialogHeader's title is the h2 above it. */}
              <Heading level={3}>Ask about this PR</Heading>
              <AskAboutPr prId={detail.pr.id} />
              {/* Same live channel as the global queue: the agent moves these
                  rows through queued → working → answered while the dialog
                  stays open. */}
              <VStack
                gap={1}
                role="log"
                aria-live="polite"
                aria-label={`Agent requests about pull request #${detail.pr.number}`}
              >
                {detail.requests.map((r) => (
                  <Card key={r.id} variant="muted" padding={2}>
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Badge
                          variant={
                            r.status === "answered"
                              ? "success"
                              : r.status === "working"
                                ? "warning"
                                : "neutral"
                          }
                          label={r.status}
                        />
                        <Text>{r.body}</Text>
                      </HStack>
                      {r.response !== "" && (
                        <Text color="secondary">{r.response}</Text>
                      )}
                    </VStack>
                  </Card>
                ))}
              </VStack>
            </VStack>
          </VStack>
        </>
      )}
    </Dialog>
  );
}
