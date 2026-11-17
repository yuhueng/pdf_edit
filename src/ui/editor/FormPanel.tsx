import { useState } from 'react';
import { checkFields, currentValue, isFilled } from '../../lib/pdf/formState.ts';
import type { FieldValues, FormField } from '../../lib/pdf/pages.ts';
import { Button, Card } from '../kit.tsx';

type Props = {
  fields: FormField[] | null;
  values: FieldValues;
  busy: boolean;
  onDetect: () => void;
  onJump: (f: FormField) => void;
  onCheck: () => void;
  /** The phone layout shows the summary outside the sheet instead. */
  showSummary?: boolean;
  compact?: boolean;
};

const TYPE_LABEL: Record<FormField['type'], string> = {
  text: 'text',
  checkbox: 'checkbox',
  radio: 'choice',
  choice: 'dropdown',
  button: 'button',
  signature: 'signature',
};

/** Detect, list and check the PDF's form fields. Filling happens on the page itself (see FormOverlay). */
export function formSummaryText(fields: FormField[], values: FieldValues): string {
  const sum = checkFields(fields, values);
  return sum.total === 0
    ? 'This PDF has no fields to fill.'
    : sum.empty.length === 0
      ? `All ${sum.total} fields are filled.`
      : `${sum.filled} of ${sum.total} fields filled. ${sum.empty.length} still to fill (outlined in amber on the page).`;
}

export function FormPanel({ fields, values, busy, onDetect, onJump, onCheck, showSummary = true, compact = false }: Props) {
  const sum = fields ? checkFields(fields, values) : null;
  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button data-tool="true" disabled={busy} onClick={onDetect}>
        {fields ? 'Detect again' : 'Detect form fields'}
      </Button>
      <Button data-tool="true" disabled={!fields || busy} onClick={onCheck}>
        Check filled fields
      </Button>
    </div>
  );
  const body = (
    <>
      {!fields && <p className="text-sm text-ink-soft">Find the fillable fields in this PDF, then type into them on the page.</p>}
      {fields && sum && (
        <>
          {showSummary && (
            <p className="text-sm" data-testid="form-summary" role="status">
              {formSummaryText(fields, values)}
            </p>
          )}
          <ul className="divide-y divide-line text-sm max-h-48 overflow-auto" data-testid="form-list">
            {fields
              .filter((f) => f.type !== 'button' && f.type !== 'signature')
              .map((f) => {
                const ok = isFilled(f, fields, values);
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => onJump(f)}
                      className="w-full min-h-[44px] flex items-center gap-2 text-left hover:bg-gray-50 px-1"
                    >
                      <span aria-hidden="true" className={ok ? 'text-ok' : 'text-amber-600'}>
                        {ok ? '✓' : '○'}
                      </span>
                      <span className="flex-1 truncate">{f.name || '(unnamed)'}</span>
                      <span className="text-xs text-ink-soft">
                        {TYPE_LABEL[f.type]} · p.{f.page + 1}
                      </span>
                      <span className="sr-only">{ok ? 'filled' : 'empty'}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </>
  );
  if (compact) {
    return (
      <div className="space-y-2.5">
        {actions}
        {body}
      </div>
    );
  }
  return (
    <Card title="Form fields" aside={actions}>
      {body}
    </Card>
  );
}

function TextBox({ f, value, zoom, onCommit }: { f: FormField; value: string; zoom: number; onCommit: (v: string) => void }) {
  // Typing edits a local draft; the stored value (and undo history) changes once, on blur.
  const [draft, setDraft] = useState<string | null>(null);
  const v = draft ?? value;
  const common = {
    'aria-label': f.name,
    value: v,
    disabled: f.readOnly,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== null && draft !== value) onCommit(draft);
      setDraft(null);
    },
    className: 'w-full h-full px-1 bg-white/80 text-black outline-none',
    style: { fontSize: Math.max(8, Math.min(f.rect[3] * zoom * 0.6, 18)) },
  };
  return f.multiline ? <textarea {...common} /> : <input type="text" {...common} />;
}

/** Inputs placed over the fields of the current page. Amber outline = still empty, green = filled. */
export function FormOverlay({
  fields,
  page,
  zoom,
  values,
  onChange,
}: {
  fields: FormField[];
  page: number;
  zoom: number;
  values: FieldValues;
  onChange: (patch: FieldValues) => void;
}) {
  return (
    <div className="absolute inset-0 z-30 pointer-events-none" data-testid="form-overlay">
      {fields
        .filter((f) => f.page === page && f.type !== 'button' && f.type !== 'signature')
        .map((f) => {
          const filled = isFilled(f, fields, values);
          const v = currentValue(f, values);
          const group = fields.filter((o) => o.type === 'radio' && o.name === f.name);
          const label = f.type === 'radio' ? `${f.name} ${f.options[group.indexOf(f)] ?? group.indexOf(f) + 1}` : f.name;
          return (
            <div
              key={f.key}
              data-testid={`field-${f.name}`}
              data-filled={filled ? 'yes' : 'no'}
              className={`absolute pointer-events-auto border-2 rounded-sm ${filled ? 'border-green-600' : 'border-amber-500 bg-amber-200/40'}`}
              style={{ left: f.rect[0] * zoom, top: f.rect[1] * zoom, width: f.rect[2] * zoom, height: f.rect[3] * zoom }}
            >
              {f.type === 'text' && <TextBox f={f} value={String(v)} zoom={zoom} onCommit={(x) => onChange({ [f.key]: x })} />}
              {f.type === 'checkbox' && (
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={v === true}
                  disabled={f.readOnly}
                  onChange={(e) => onChange({ [f.key]: e.target.checked })}
                  className="w-full h-full accent-accent"
                />
              )}
              {f.type === 'radio' && (
                <input
                  type="radio"
                  name={f.name}
                  aria-label={label}
                  checked={v === true}
                  disabled={f.readOnly}
                  onChange={() =>
                    // Switching one radio on switches the rest of its group off (one history step).
                    onChange({ ...Object.fromEntries(group.map((o) => [o.key, false])), [f.key]: true })
                  }
                  className="w-full h-full accent-accent"
                />
              )}
              {f.type === 'choice' && (
                <select
                  aria-label={label}
                  value={String(v)}
                  disabled={f.readOnly}
                  onChange={(e) => onChange({ [f.key]: e.target.value })}
                  className="w-full h-full bg-white/80 text-black"
                  style={{ fontSize: Math.max(8, Math.min(f.rect[3] * zoom * 0.6, 18)) }}
                >
                  <option value="">(choose)</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
    </div>
  );
}
