import { useRef, useState } from "react";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { post } from "../useRegion";
import type { EditableColumn } from "../types";

/**
 * One click-to-edit grid cell.
 *
 * Display state is a flat button (keyboard-reachable, unlike a div); clicking or
 * pressing Enter swaps in a TextInput. Enter or blur commits, Escape cancels.
 *
 * No optimistic update: the POST publishes, SSE invalidates `grid`, and the new
 * value arrives as a fresh `value` prop. The cell therefore always shows what
 * SQLite holds, and an agent patch landing mid-edit is not silently overwritten.
 */
export function EditableCell({
  rowId,
  column,
  value,
  align = "start",
}: {
  readonly rowId: number;
  readonly column: EditableColumn;
  readonly value: string;
  readonly align?: "start" | "end";
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Guards the commit against firing twice. Enter commits and closes the input;
  // the browser then fires blur on the disappearing element, which would POST a
  // second identical write. Escape sets it too, so the trailing blur is a no-op
  // instead of committing the value the user just abandoned.
  const isSettled = useRef(false);

  const open = () => {
    isSettled.current = false;
    setDraft(value);
    setIsEditing(true);
  };

  const commit = () => {
    if (isSettled.current) return;
    isSettled.current = true;
    setIsEditing(false);
    if (draft === value) return;
    // A rejected write (bad column, unparseable amount) throws; the region never
    // changed, so the cell repaints its old value on the next invalidation.
    void post(`/api/rows/${rowId}/cell`, { column, value: draft }).catch(() => {});
  };

  const cancel = () => {
    isSettled.current = true;
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <TextInput
          {...{ autoComplete: "off", "data-lpignore": "true" }}
        label={`${column} for row ${rowId}`}
        isLabelHidden
        size="sm"
        value={draft}
        hasAutoFocus
        onChange={(next) => setDraft(next)}
        onEnter={commit}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
        data-testid={`input-${rowId}-${column}`}
      />
    );
  }

  return (
    <button
      type="button"
      // The value alone reads as a static label ("Flight SEA→IAD, button"); the
      // name has to carry both the action and the coordinates. index.html owns
      // the matching :focus-visible ring, which an inline style cannot express.
      aria-label={`Edit ${column} for row ${rowId}`}
      className="cell-btn"
      onClick={open}
      style={{
        background: "transparent",
        border: "1px dashed transparent",
        borderRadius: 4,
        padding: "2px 4px",
        margin: "-2px -4px",
        font: "inherit",
        color: "inherit",
        cursor: "text",
        display: "block",
        width: "100%",
        minWidth: 0,
        textAlign: align === "end" ? "right" : "left",
      }}
      data-testid={`cell-${rowId}-${column}`}
    >
      {value === "" ? (
        <Text type="supporting" color="placeholder">
          —
        </Text>
      ) : (
        <Text maxLines={1} hasTabularNumbers={column === "amount" || column === "date"}>
          {value}
        </Text>
      )}
    </button>
  );
}
