import { Button, Icon, IconButton } from '../kit.tsx';
import type { DrawStyle, EditorTool, FontFamilyKey } from './tools.ts';

type Props = {
  tool: EditorTool;
  style: DrawStyle;
  hasSelection: boolean;
  /** What is selected on the page, if anything: text, highlight, shape, image or draw. */
  selectionKind: string | null;
  onChange: (patch: Partial<DrawStyle>) => void;
  onBringFront: () => void;
  onSendBack: () => void;
  onDelete: () => void;
};

const SWATCHES = [
  { name: 'Yellow', hex: '#ffeb3b' },
  { name: 'Green', hex: '#a5f3a1' },
  { name: 'Pink', hex: '#f9a8d4' },
  { name: 'Blue', hex: '#93c5fd' },
];

function Swatches({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div role="group" aria-label="Highlight colour" className="flex items-center gap-2.5">
      {SWATCHES.map((s) => (
        <button
          key={s.hex}
          type="button"
          aria-label={s.name}
          aria-pressed={value === s.hex}
          onClick={() => onChange(s.hex)}
          style={{ background: s.hex }}
          className={`h-6 w-6 rounded-full border border-border-strong/40 transition-shadow duration-150 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8 ${
            value === s.hex ? 'ring-2 ring-accent ring-offset-2' : ''
          }`}
        />
      ))}
      <label className="relative" title="Custom colour">
        <span className="sr-only">Custom highlight colour</span>
        <input
          type="color"
          aria-label="Custom highlight colour"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded-full border border-border-strong/40 bg-transparent p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"
        />
      </label>
    </div>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium">
      {label}
      <input
        type="color"
        aria-label={label === 'Stroke' ? 'Color' : label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded-full border border-border-strong/40 bg-transparent p-0 [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"
      />
    </label>
  );
}

function Slider({ label, value, onChange, min = 0.1, max = 1, step = 0.05 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium">
      {label}
      <input
        type="range"
        className="yh-range w-24"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--fill' as string]: fill }}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-9 font-mono text-[13px] tabular-nums text-text-muted">{Math.round(value * 100)}%</span>
    </label>
  );
}

function Num({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium">
      {label}
      <input
        type="number"
        aria-label={label === 'Size' ? 'Font size' : label}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="min-h-9 w-16 rounded-md border border-border-strong bg-surface px-2 text-sm tabular-nums [@media(pointer:coarse)]:min-h-10"
      />
    </label>
  );
}

function Toggle({ label, on, onClick, children, className = '' }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-9 min-w-9 rounded-md text-sm transition-colors duration-150 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:min-w-10 ${
        on ? 'bg-accent-tint text-accent' : 'text-text-secondary hover:bg-surface-sunken'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Settings for the active tool only. Shapes, text and highlights each show what they need. */
export function ContextBar({ tool, style, hasSelection, selectionKind, onChange, onBringFront, onSendBack, onDelete }: Props) {
  const kind = tool === 'select' ? selectionKind : null;
  const showText = tool === 'text' || kind === 'text';
  const showHighlight = tool === 'highlight' || tool === 'highlightText' || kind === 'highlight';
  const showDraw = tool === 'draw' || kind === 'draw';
  const showShape = tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || kind === 'shape';
  const linear = tool === 'line' || tool === 'arrow';
  const nothing = !showText && !showHighlight && !showDraw && !showShape && kind !== 'image';

  return (
    <div role="group" aria-label="Tool settings" className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 px-1 py-1.5" data-testid="context-bar">
      {nothing && (
        <p className="flex items-center gap-2 text-[13px] text-text-muted">
          <Icon name="select" size={14} /> {tool === 'select' ? 'Select an object on the page, or choose a tool.' : tool === 'hand' ? 'Drag to move the page. Choose Select to pick objects.' : 'This tool has no settings.'}
        </p>
      )}

      {showHighlight && (
        <>
          <Swatches value={style.highlight} onChange={(hex) => onChange({ highlight: hex })} />
          <Slider label="Opacity" value={style.hlOpacity} onChange={(v) => onChange({ hlOpacity: v })} />
        </>
      )}

      {showText && (
        <>
          <label className="flex items-center gap-2 text-[13px] font-medium">
            Font
            <select
              aria-label="Font family"
              value={style.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value as FontFamilyKey })}
              className="min-h-9 rounded-md border border-border-strong bg-surface px-2 text-sm [@media(pointer:coarse)]:min-h-10"
            >
              <option value="sans">Sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Mono</option>
            </select>
          </label>
          <Num label="Size" value={style.fontSize} min={8} max={72} onChange={(v) => onChange({ fontSize: v })} />
          <div className="flex gap-0.5">
            <Toggle label="Bold" on={style.bold} onClick={() => onChange({ bold: !style.bold })} className="font-bold">B</Toggle>
            <Toggle label="Italic" on={style.italic} onClick={() => onChange({ italic: !style.italic })} className="italic">I</Toggle>
            <Toggle label="Underline" on={style.underline} onClick={() => onChange({ underline: !style.underline })} className="underline">U</Toggle>
            <Toggle label="Strikethrough" on={style.strike} onClick={() => onChange({ strike: !style.strike })} className="line-through">S</Toggle>
          </div>
          <ColorInput label="Stroke" value={style.stroke} onChange={(hex) => onChange({ stroke: hex })} />
          <Slider label="Opacity" value={style.opacity} onChange={(v) => onChange({ opacity: v })} />
        </>
      )}

      {(showDraw || showShape) && (
        <>
          <ColorInput label="Stroke" value={style.stroke} onChange={(hex) => onChange({ stroke: hex })} />
          {showShape && !linear && (
            <>
              <label className="flex min-h-9 items-center gap-2 text-[13px] font-medium">
                <input type="checkbox" checked={style.fill !== null} onChange={(e) => onChange({ fill: e.target.checked ? style.stroke : null })} className="h-4 w-4 accent-accent" />
                Fill
              </label>
              {style.fill !== null && <ColorInput label="Fill color" value={style.fill} onChange={(hex) => onChange({ fill: hex })} />}
            </>
          )}
          <Num label="Width" value={style.strokeWidth} min={1} max={24} onChange={(v) => onChange({ strokeWidth: v })} />
          <Slider label="Opacity" value={style.opacity} onChange={(v) => onChange({ opacity: v })} />
        </>
      )}

      {hasSelection && (
        <div className="ml-auto flex items-center gap-1">
          <Button size="md" variant="ghost" onClick={onBringFront}>
            Bring front
          </Button>
          <Button size="md" variant="ghost" onClick={onSendBack}>
            Send back
          </Button>
          <IconButton icon="trash" label="Delete" danger onClick={onDelete} />
        </div>
      )}
    </div>
  );
}
