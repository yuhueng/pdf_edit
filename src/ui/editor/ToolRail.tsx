import { DropdownMenu, IconButton, type IconName } from "../kit.tsx";
import type { EditorTool } from "./tools.ts";

export const TOOL_BUTTONS: Array<{
  id: EditorTool;
  label: string;
  icon: IconName;
  key: string;
}> = [
  { id: "select", label: "Select", icon: "select", key: "V" },
  { id: "hand", label: "Hand", icon: "hand", key: "G" },
  { id: "text", label: "Text", icon: "text", key: "T" },
  { id: "draw", label: "Draw", icon: "draw", key: "P" },
];
export const HIGHLIGHT_BUTTONS: Array<{
  id: EditorTool;
  label: string;
  icon: IconName;
  key: string;
}> = [
  { id: "highlightText", label: "Highlight text", icon: "highlight", key: "J" },
  { id: "highlight", label: "Highlight area", icon: "highlight", key: "H" },
];
export const SHAPE_BUTTONS: Array<{
  id: EditorTool;
  label: string;
  icon: IconName;
  key: string;
}> = [
  { id: "rect", label: "Rectangle", icon: "rect", key: "R" },
  { id: "ellipse", label: "Ellipse", icon: "ellipse", key: "E" },
  { id: "line", label: "Line", icon: "line", key: "L" },
  { id: "arrow", label: "Arrow", icon: "arrow", key: "A" },
];

type Props = {
  tool: EditorTool;
  onTool: (t: EditorTool) => void;
  editText: boolean;
  onEditText: () => void;
  onImage: () => void;
  onSignature: () => void;
  onDateStamp: () => void;
  formOpen: boolean;
  onForm: () => void;
  pagesOpen?: boolean;
  /** Phones only: opens the Pages sheet. */
  onPages?: () => void;
  /** Vertical rail on tablet and desktop, a scrolling bottom toolbar on phones. */
  orientation: "vertical" | "horizontal";
};

function Divider({ horizontal }: { horizontal: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        horizontal
          ? "mx-1 h-6 w-px shrink-0 bg-divider"
          : "my-1 h-px w-6 bg-divider"
      }
    />
  );
}

/** The tools, grouped: select and mark-up, shapes, insert, then page-level actions. */
export function ToolRail(p: Props) {
  const horizontal = p.orientation === "horizontal";
  const size = horizontal ? "lg" : "md";
  const shapeActive = SHAPE_BUTTONS.some((s) => s.id === p.tool);
  return (
    <div
      role="toolbar"
      aria-label="Editing tools"
      aria-orientation={p.orientation}
      className={
        horizontal
          ? "flex items-center gap-1 overflow-x-auto px-2"
          : "flex w-14 flex-col items-center gap-1 rounded-xl border border-border bg-surface p-1.5"
      }
    >
      {/* Select and Hand share the first slot: tapping it while one is on switches to the other. */}
      {p.tool === "hand" ? (
        <IconButton
          icon="hand"
          label="Hand"
          tip="Hand: drag to move the page. Tap for Select"
          shortcut="G"
          size={size}
          active
          onClick={() => p.onTool("select")}
        />
      ) : (
        <IconButton
          icon="select"
          label="Select"
          tip={p.tool === "select" ? "Select. Tap for Hand (move the page)" : "Select"}
          shortcut="V"
          size={size}
          active={p.tool === "select"}
          onClick={() => p.onTool(p.tool === "select" ? "hand" : "select")}
        />
      )}
      {TOOL_BUTTONS.filter((t) => t.id !== "select" && t.id !== "hand").map((t) => (
        <IconButton
          key={t.id}
          icon={t.icon}
          label={t.label}
          shortcut={t.key}
          size={size}
          active={p.tool === t.id}
          onClick={() => p.onTool(t.id)}
        />
      ))}
      <DropdownMenu
        label="Highlight"
        icon="highlight"
        pressed={HIGHLIGHT_BUTTONS.some((h) => h.id === p.tool)}
        side={horizontal ? "top" : "right"}
        align="left"
        items={HIGHLIGHT_BUTTONS.map((h) => ({
          label: `${h.label} · ${h.key}`,
          icon: h.icon,
          onSelect: () => p.onTool(h.id),
        }))}
      />
      <DropdownMenu
        label="Shapes"
        icon="shapes"
        pressed={shapeActive}
        side={horizontal ? "top" : "right"}
        align="left"
        items={SHAPE_BUTTONS.map((s) => ({
          label: `${s.label} · ${s.key}`,
          icon: s.icon,
          onSelect: () => p.onTool(s.id),
        }))}
      />
      <Divider horizontal={horizontal} />
      <IconButton icon="image" label="Image" size={size} onClick={p.onImage} />
      <IconButton
        icon="signature"
        label="Signature"
        size={size}
        onClick={p.onSignature}
      />
      <IconButton
        icon="calendar"
        label="Date stamp"
        size={size}
        onClick={p.onDateStamp}
      />
      <Divider horizontal={horizontal} />
      <IconButton
        icon="edit"
        label="Edit text"
        size={size}
        active={p.editText}
        onClick={p.onEditText}
      />
      <IconButton
        icon="formField"
        label="Form fields"
        size={size}
        active={p.formOpen}
        onClick={p.onForm}
      />
      {p.onPages && (
        <IconButton
          icon="layers"
          label="Pages"
          size={size}
          active={p.pagesOpen}
          onClick={p.onPages}
        />
      )}
    </div>
  );
}
