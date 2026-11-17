import {
  ArrowLeftRight,
  ArrowUpRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Columns2,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  GripVertical,
  Highlighter,
  Image as ImageIcon,
  Info,
  Keyboard,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  Hand,
  MousePointer2,
  Pencil,
  PenLine,
  PenTool,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Share2,
  Shapes,
  Slash,
  Square,
  Trash2,
  TriangleAlert,
  Type,
  TextCursorInput,
  Undo2,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from 'react';

// ---------------------------------------------------------------------------
// Icons: Lucide only. Outline, 1.75 stroke, inherit the text colour.
// ---------------------------------------------------------------------------
const ICONS = {
  rotateLeft: RotateCcw,
  rotateRight: RotateCw,
  trash: Trash2,
  close: X,
  plus: Plus,
  minus: Minus,
  fit: Maximize2,
  prev: ChevronLeft,
  next: ChevronRight,
  select: MousePointer2,
  hand: Hand,
  text: Type,
  draw: Pencil,
  highlight: Highlighter,
  rect: Square,
  ellipse: Circle,
  line: Slash,
  arrow: ArrowUpRight,
  image: ImageIcon,
  signature: PenTool,
  calendar: Calendar,
  save: Save,
  folder: FolderOpen,
  undo: Undo2,
  redo: Redo2,
  share: Share2,
  download: Download,
  check: Check,
  alert: TriangleAlert,
  info: Info,
  lock: Lock,
  unlock: LockOpen,
  layers: Columns2,
  compress: Minimize2,
  convert: ArrowLeftRight,
  chevronDown: ChevronDown,
  tools: Wrench,
  expand: Maximize2,
  edit: PenLine,
  more: Ellipsis,
  grip: GripVertical,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  eye: Eye,
  eyeOff: EyeOff,
  help: CircleHelp,
  file: FileText,
  keyboard: Keyboard,
  shapes: Shapes,
  formField: TextCursorInput,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  const Cmp = ICONS[name];
  return <Cmp size={size} strokeWidth={1.75} aria-hidden="true" className={`shrink-0 ${className}`} />;
}

// ---------------------------------------------------------------------------
// Spinner, skeleton, progress
// ---------------------------------------------------------------------------
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="yh-spin shrink-0"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** Page-shaped placeholder while a thumbnail renders. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`yh-skeleton rounded-md flex flex-col gap-1.5 p-3 ${className}`}>
      <span className="block h-1.5 w-2/3 rounded-pill bg-thumb-heading" />
      <span className="block h-1 w-full rounded-pill bg-thumb-line" />
      <span className="block h-1 w-full rounded-pill bg-thumb-line" />
      <span className="block h-1 w-4/5 rounded-pill bg-thumb-line" />
    </div>
  );
}

/** Determinate bar with a step label on the left and the percentage on the right; indeterminate when `value` is null. */
export function ProgressBar({ value, label, step }: { value: number | null; label: string; step?: string }) {
  return (
    <div className="flex-1 min-w-[160px]">
      <div className="flex items-baseline justify-between text-xs text-text-muted mb-1.5">
        <span>{step ?? label}</span>
        {value !== null && <span className="font-mono tabular-nums">{Math.round(value)}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        className="h-1 rounded-pill bg-surface-sunken overflow-hidden"
      >
        {value === null ? (
          <div className="h-full w-[30%] bg-accent rounded-pill" style={{ animation: 'yh-indeterminate 1.4s linear infinite' }} />
        ) : (
          <div className="h-full bg-accent rounded-pill transition-[width] duration-200" style={{ width: `${value}%` }} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
type Variant =
  | 'primary'
  | 'secondary'
  | 'text'
  | 'ghost'
  | 'dashed'
  | 'destructive'
  | 'destructive-ghost'
  // earlier names, mapped onto the guide's variants
  | 'ok'
  | 'danger';
type Size = 'xl' | 'lg' | 'md' | 'sm';

const BASE =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap select-none ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-standard)] ' +
  'active:scale-[0.98] active:duration-75 disabled:cursor-not-allowed';

const VARIANT: Record<Exclude<Variant, 'ok' | 'danger'>, string> = {
  primary:
    'bg-accent text-text-on-accent font-semibold hover:bg-accent-hover active:bg-accent-pressed ' +
    'disabled:bg-surface-sunken disabled:text-text-disabled disabled:active:scale-100',
  secondary:
    'bg-surface text-text font-medium border border-border hover:bg-surface-muted hover:border-border-hover active:bg-surface-sunken ' +
    'disabled:text-text-disabled disabled:border-divider disabled:hover:bg-surface disabled:active:scale-100',
  text: 'text-accent font-semibold hover:bg-surface-muted active:bg-surface-sunken disabled:text-text-disabled disabled:active:scale-100',
  ghost:
    'text-text-secondary font-medium hover:bg-surface-muted active:bg-surface-sunken disabled:text-text-disabled disabled:active:scale-100',
  dashed:
    'text-text font-medium border border-dashed border-border-dashed hover:bg-surface-muted hover:border-border-strong ' +
    'disabled:text-text-disabled disabled:active:scale-100',
  destructive: 'bg-danger text-white font-semibold hover:bg-danger-hover active:bg-danger-hover disabled:bg-surface-sunken disabled:text-text-disabled',
  'destructive-ghost': 'text-danger font-medium hover:bg-danger-tint active:bg-danger-tint disabled:text-text-disabled disabled:active:scale-100',
};
const ALIAS: Record<'ok' | 'danger', Exclude<Variant, 'ok' | 'danger'>> = { ok: 'primary', danger: 'destructive-ghost' };

// 44px minimum hit area on touch devices for every size.
const COARSE = '[@media(pointer:coarse)]:min-h-10';
const SIZE: Record<Size, string> = {
  xl: 'min-h-12 px-5 text-sm leading-6 rounded-lg sm:min-h-[52px] sm:text-[15px]',
  lg: 'min-h-10 px-4 text-[13px] rounded-md sm:min-h-11 sm:text-sm',
  md: `min-h-9 px-3.5 text-[13px] rounded-md ${COARSE}`,
  sm: `min-h-8 px-3 text-[13px] rounded-sm ${COARSE}`,
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Shows a spinner and this label instead of the normal content; the button stays focusable but ignores clicks. */
  loading?: boolean;
  loadingLabel?: string;
};

export function Button({
  variant = 'secondary',
  size = 'lg',
  icon,
  loading = false,
  loadingLabel,
  className = '',
  children,
  onClick,
  disabled,
  ...rest
}: ButtonProps) {
  const v = variant === 'ok' || variant === 'danger' ? ALIAS[variant] : variant;
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? undefined : onClick}
      className={`${BASE} ${SIZE[size]} ${VARIANT[v]} ${className}`}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icon buttons and tooltips
// ---------------------------------------------------------------------------
type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> & {
  icon: IconName;
  /** Accessible name and tooltip. Tests and screen readers match on this text. */
  label: string;
  /** Shorter tooltip when the accessible name is long. */
  tip?: string;
  shortcut?: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** The icon turns red on hover (trash and other destructive icons). */
  danger?: boolean;
  /** Earlier API: colour hint, ignored now that icon buttons are always the quiet style. */
  variant?: Variant;
};

const IB_SIZE = {
  sm: { box: 'w-7 h-7 rounded-sm', icon: 14, hit: 'after:absolute after:-inset-2 after:content-[""]' },
  md: { box: 'w-9 h-9 rounded-md', icon: 18, hit: '[@media(pointer:coarse)]:w-10 [@media(pointer:coarse)]:h-10' },
  lg: { box: 'w-11 h-11 rounded-md', icon: 20, hit: '' },
} as const;

/** Tooltip text drawn in a portal, so no scroll box or neighbouring button can clip or cover it. */
function Tooltip({ x, y, below, text }: { x: number; y: number; below: boolean; text: string }) {
  return createPortal(
    <span
      role="presentation"
      aria-hidden="true"
      style={{ left: x, top: y, transform: `translate(-50%, ${below ? '0' : '-100%'})` }}
      className="yh-fade-in pointer-events-none fixed z-[1000] whitespace-nowrap rounded-xs bg-text px-2 py-1 text-xs text-white shadow-2"
    >
      {text}
    </span>,
    document.body,
  );
}

/** Shows a tip after 400ms of hover or keyboard focus (never on touch), above the button when there is room. */
function useTooltip() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = (el: HTMLElement) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const x = Math.max(60, Math.min(window.innerWidth - 60, r.left + r.width / 2));
      const below = r.top < 36;
      setPos({ x, y: below ? r.bottom + 6 : r.top - 6, below });
      setOpen(true);
    }, 400);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const handlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      if (window.matchMedia('(hover: hover)').matches) show(e.currentTarget);
    },
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
    },
    onBlur: hide,
    onMouseDown: hide, // a click must not be swallowed here: the caller's onClick stays untouched
  };
  return { open, pos, handlers };
}

export function IconButton({
  icon,
  label,
  tip,
  shortcut,
  active,
  size = 'md',
  danger,
  variant: _variant,
  className = '',
  ...rest
}: IconButtonProps) {
  void _variant;
  const s = IB_SIZE[size];
  const { open: tip_open, pos: tipPos, handlers } = useTooltip();
  const tipText = `${tip ?? label}${shortcut ? ` · ${shortcut}` : ''}`;
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      aria-pressed={active}
      {...handlers}
      className={`group/ib relative inline-flex items-center justify-center shrink-0 ${s.box} ${s.hit} ${
        active
          ? 'bg-accent-tint text-accent'
          : `text-text-muted hover:bg-surface-sunken ${danger ? 'hover:text-danger' : 'hover:text-text'}`
      } transition-colors duration-150 active:scale-[0.98] disabled:text-text-disabled disabled:hover:bg-transparent disabled:cursor-not-allowed ${className}`}
    >
      <Icon name={icon} size={s.icon} />
      {tip_open && tipPos && <Tooltip x={tipPos.x} y={tipPos.y} below={tipPos.below} text={tipText} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Badges, status, notices
// ---------------------------------------------------------------------------
/** The "F1" file ID badge: the same green tint everywhere a file appears. */
export function IdBadge({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-xs bg-accent-tint px-1.5 py-0.5 font-mono text-[11px] leading-4 text-accent ${className}`}>
      F{n}
    </span>
  );
}

type StatusKind = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'working';
const PILL: Record<StatusKind, string> = {
  neutral: 'bg-surface-sunken text-text-secondary',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
  info: 'bg-info-tint text-info',
  working: 'bg-info-tint text-info',
};
const PILL_ICON: Record<StatusKind, IconName | null> = {
  neutral: null,
  success: 'check',
  warning: 'alert',
  danger: 'alert',
  info: 'info',
  working: null,
};

/** Status is always colour + icon + word, never colour alone. */
export function StatusPill({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  const icon = PILL_ICON[kind];
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 rounded-pill px-2.5 text-xs font-medium ${PILL[kind]}`}>
      {kind === 'working' ? <Spinner size={12} /> : icon ? <Icon name={icon} size={12} /> : <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
      {children}
    </span>
  );
}

const NOTICE: Record<'info' | 'success' | 'warning' | 'danger', { cls: string; icon: IconName }> = {
  info: { cls: 'bg-info-tint text-info', icon: 'info' },
  success: { cls: 'bg-success-tint text-success', icon: 'check' },
  warning: { cls: 'bg-warning-tint text-warning', icon: 'alert' },
  danger: { cls: 'bg-danger-tint text-danger', icon: 'alert' },
};

/** Inline banner: status tint, icon, text, optional action. Never a left stripe. */
export function Notice({
  kind,
  children,
  action,
  className = '',
}: {
  kind: keyof typeof NOTICE;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const n = NOTICE[kind];
  return (
    <div
      role={kind === 'danger' ? 'alert' : 'status'}
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg px-3.5 py-3 text-sm ${n.cls} ${className}`}
    >
      <Icon name={n.icon} size={16} className="mt-0.5" />
      <div className="min-w-[12rem] flex-1 text-text">{children}</div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
export const INPUT =
  'w-full min-h-9 [@media(pointer:coarse)]:min-h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-text ' +
  'placeholder:text-text-muted transition-[border-color,box-shadow] duration-150 hover:border-text-secondary ' +
  'focus-visible:border-accent disabled:bg-surface-muted disabled:text-text-disabled disabled:border-divider disabled:cursor-not-allowed';

/** Label above, helper and error text below, wired together with aria-describedby. */
export function Field({
  label,
  help,
  error,
  children,
  className = '',
}: {
  label: string;
  help?: ReactNode;
  error?: string | null;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[13px] font-medium leading-[18px] text-text">
        {label}
      </label>
      {children({ id, 'aria-describedby': error || help ? msgId : undefined, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={msgId} role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <Icon name="alert" size={14} /> {error}
        </p>
      ) : help ? (
        <p id={msgId} className="text-xs text-text-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  help,
  error,
  className = '',
  inputClassName = '',
  ref,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  help?: ReactNode;
  error?: string | null;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      {(p) => (
        <input
          ref={ref}
          {...input}
          {...p}
          className={`${INPUT} ${error ? 'border-danger focus-visible:border-danger' : ''} ${inputClassName}`}
        />
      )}
    </Field>
  );
}

/** Number field with its unit inside on the right ("5 MB"). */
export function UnitField({
  label,
  unit,
  help,
  error,
  className = '',
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; unit: string; help?: ReactNode; error?: string | null }) {
  return (
    <Field label={label} help={help} error={error} className={className}>
      {(p) => (
        <span className="relative block w-[120px]">
          <input type="number" {...input} {...p} className={`${INPUT} pr-10 tabular-nums`} />
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">
            {unit}
          </span>
        </span>
      )}
    </Field>
  );
}

export function SelectField({
  label,
  help,
  className = '',
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; help?: ReactNode }) {
  return (
    <Field label={label} help={help} className={className}>
      {(p) => (
        <span className="relative block">
          <select {...select} {...p} className={`${INPUT} appearance-none pr-9`}>
            {children}
          </select>
          <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted" />
        </span>
      )}
    </Field>
  );
}

const CHECK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E\")";
const DASH_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M4 8h8'/%3E%3C/svg%3E\")";

export function Checkbox({
  label,
  help,
  indeterminate = false,
  bordered = false,
  className = '',
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; help?: ReactNode; indeterminate?: boolean; bordered?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const help_id = useId();
  return (
    <div className={className}>
      <label
        className={`inline-flex items-center cursor-pointer text-[13px] text-text sm:text-sm ${
          bordered ? 'min-h-8 gap-1.5 rounded-md border border-border-strong bg-surface px-2 hover:bg-surface-muted' : 'min-h-10 gap-2.5 sm:min-h-11'
        }`}
      >
        <input
          ref={ref}
          type="checkbox"
          aria-describedby={help ? help_id : undefined}
          {...input}
          style={{ backgroundImage: indeterminate ? DASH_SVG : input.checked ? CHECK_SVG : undefined, backgroundSize: '14px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
          className="appearance-none shrink-0 w-5 h-5 rounded-xs border-[1.5px] border-border-strong bg-surface transition-colors duration-150 hover:border-text-secondary checked:bg-accent checked:border-accent indeterminate:bg-accent indeterminate:border-accent disabled:bg-surface-muted disabled:border-divider cursor-pointer"
        />
        {label}
      </label>
      {help && (
        <p id={help_id} className="pl-[30px] -mt-1 text-xs text-text-muted max-w-[68ch]">
          {help}
        </p>
      )}
    </div>
  );
}

/** For settings that take effect immediately. */
export function Toggle({
  label,
  className = '',
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string }) {
  return (
    <label className={`inline-flex items-center gap-3 min-h-11 cursor-pointer text-sm ${className}`}>
      <input
        type="checkbox"
        role="switch"
        {...input}
        className="appearance-none relative shrink-0 w-9 h-5 rounded-pill bg-border-strong checked:bg-accent transition-colors duration-150 cursor-pointer before:content-[''] before:absolute before:top-0.5 before:left-0.5 before:w-4 before:h-4 before:rounded-full before:bg-white before:transition-transform before:duration-150 checked:before:translate-x-4"
      />
      {label}
    </label>
  );
}

/** A small set of mutually exclusive options. Arrow keys move the selection. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = options[(idx + d + options.length) % options.length]!;
    onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={`inline-flex gap-0.5 rounded-pill bg-surface-sunken p-[3px] ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={`${size === 'sm' ? 'min-h-7 px-3' : 'min-h-8 px-3.5'} [@media(pointer:coarse)]:min-h-10 rounded-pill text-[13px] transition-[background-color,box-shadow,color] duration-150 ${
              on ? 'bg-surface text-text font-semibold shadow-1' : 'text-text-secondary font-medium hover:text-text hover:bg-white/50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels and collapsing
// ---------------------------------------------------------------------------
/** Animates open/closed with grid-template-rows (never height), and removes closed content from the tab order. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-[var(--ease-standard)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      aria-hidden={!open || undefined}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export const CARD = 'bg-surface border border-border rounded-xl p-4 sm:p-6';

/** A top-level work area: white, 1px border, 16px radius, no shadow. Title row with optional actions on the right. */
export function Card({
  title,
  aside,
  children,
  className = '',
  collapsible = false,
  defaultOpen = true,
  headingLevel = 2,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Adds a chevron that folds the panel down to its title row. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  headingLevel?: 2 | 3;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section aria-label={title} className={`${CARD} min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 mb-4 sm:mb-5">
        <Heading className="text-[17px] leading-6 font-semibold mr-auto">{title}</Heading>
        {(!collapsible || open) && aside}
        {collapsible && (
          <IconButton
            icon="chevronDown"
            label={`${open ? 'Collapse' : 'Expand'} ${title}`}
            tip={open ? 'Collapse' : 'Expand'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
        )}
      </div>
      <Collapse open={!collapsible || open}>
        <div className="space-y-4">{children}</div>
      </Collapse>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state used as the drop zone on each tool's first screen
// ---------------------------------------------------------------------------
export function EmptyState({
  icon = 'file',
  title,
  hint,
  children,
  caption,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  children?: ReactNode;
  caption?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-center py-12 px-4">
      <span className="text-text-muted">
        <Icon name={icon} size={40} />
      </span>
      <h2 className="text-xl leading-7 font-semibold">{title}</h2>
      {hint && <p className="text-sm text-text-muted max-w-[44ch]">{hint}</p>}
      {children}
      {caption && <p className="text-xs text-text-muted">{caption}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------
export type MenuItem = { label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean };

export function DropdownMenu({
  label,
  items,
  align = 'right',
  icon = 'more',
  pressed,
  side = 'bottom',
}: {
  label: string;
  items: MenuItem[];
  align?: 'left' | 'right';
  icon?: IconName;
  pressed?: boolean;
  /** `right` opens the menu beside the button (a vertical tool rail), `top` above it (a bottom toolbar). */
  side?: 'bottom' | 'right' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const menuEl = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<CSSProperties>({});

  // The menu is drawn in a portal at a fixed spot, so a scrolling toolbar or sidebar can never clip it.
  const toggle = () => {
    if (!open && root.current) {
      const r = root.current.getBoundingClientRect();
      const pad = 8;
      const w = 200;
      const left = Math.max(pad, Math.min(window.innerWidth - w - pad, side === 'right' ? r.right + 6 : align === 'right' ? r.right - w : r.left));
      setAt(
        side === 'right'
          ? { left, top: r.top }
          : side === 'top'
            ? { left, bottom: window.innerHeight - r.top + 6 }
            : { left, top: r.bottom + 4 },
      );
    }
    setActive(0);
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !menuEl.current?.contains(t)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    const cur = enabled.indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(enabled[(cur + 1) % enabled.length]!);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(enabled[(cur - 1 + enabled.length) % enabled.length]!);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const it = items[active];
      if (it && !it.disabled) {
        setOpen(false);
        it.onSelect();
      }
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <IconButton icon={icon} label={label} active={pressed} aria-haspopup="menu" aria-expanded={open} onClick={toggle} />
      {open &&
        createPortal(
        <div
          ref={menuEl}
          role="menu"
          aria-label={label}
          style={at}
          onKeyDown={onKey}
          className="yh-fade-in fixed z-[1000] w-[200px] rounded-lg border border-border bg-surface p-1.5 shadow-2"
        >
          {items.map((it, i) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              ref={(el) => {
                if (el && i === active) el.focus({ preventScroll: true });
              }}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 min-h-9 text-sm text-left hover:bg-surface-muted ${it.danger ? 'text-danger' : 'text-text'} ${i === active ? 'bg-surface-muted' : ''} disabled:text-text-disabled`}
            >
              {it.icon && <Icon name={it.icon} size={16} />}
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** The white "Add PDFs" / "Change PDF" button of a PageBar. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" icon="plus" onClick={onClick} className="bg-white">
      {label}
    </Button>
  );
}

/**
 * The one slim bar under the header on every tool: title (web only, phones show it in the header), a short
 * status, the add-files button, and the tab's main action (shown below `hideActionAt`, where no side card has it).
 */
export function PageBar({
  title,
  description,
  status,
  add,
  hideActionAt = 'sm',
  children,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  add?: ReactNode;
  hideActionAt?: 'sm' | 'lg';
  children?: ReactNode;
}) {
  const bare = !status && !add && !children; // nothing to show on a phone: keep only the heading for screen readers
  return (
    <div
      className={`sticky top-14 z-[var(--z-sticky)] -mx-4 flex min-h-12 items-center gap-2.5 border-b border-border bg-[rgba(246,245,241,0.95)] px-4 py-2 backdrop-blur-sm sm:top-[var(--header-h)] sm:-mx-6 sm:min-h-14 sm:px-6 lg:-mx-10 lg:px-10 ${
        bare ? 'max-sm:sr-only' : ''
      }`}
    >
      <h1 title={description} className="shrink-0 font-display text-[26px] leading-8 font-normal tracking-[-0.01em] max-sm:sr-only lg:text-[30px]">
        {title}
      </h1>
      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-muted tabular-nums sm:text-sm">{status}</p>
      {add}
      {children && <div className={`flex shrink-0 items-center gap-2 ${hideActionAt === 'lg' ? 'lg:hidden' : 'sm:hidden'}`}>{children}</div>}
    </div>
  );
}
