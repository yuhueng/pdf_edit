import { useEffect, useRef } from 'react';
import { Hud } from './Hud.tsx';
import { Button, Icon } from './kit.tsx';

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/Cmd + O', 'Add PDFs'],
  ['Ctrl/Cmd + A', 'Select all pages (when the page grid has focus)'],
  ['Esc', 'Clear the selection, or close a panel'],
  ['Space', 'Tick or untick the focused page'],
  ['Shift + ← / →', 'Extend the selection'],
  ['Alt + ← / →', 'Move a page earlier or later in a new file'],
  ['Ctrl/Cmd + S', 'Save (Edit)'],
  ['Ctrl/Cmd + Z / Shift + Z', 'Undo / redo (Edit)'],
  ['?', 'Show this list'],
];

const SOURCE_URL = 'https://github.com/yuhueng/pdf_edit';

const PRIVACY = [
  'Nothing is uploaded. Every PDF is opened, merged, edited, compressed and converted by code running inside this page.',
  'Nothing is saved to a database or sent to any server. There is no account, no tracking and no cloud copy.',
  'Your files live only in memory. They disappear when you close or refresh the tab, or press “Clear all now”.',
  'Once the app has loaded it keeps working offline.',
  'Passwords you type for protected PDFs are used once to unlock a copy in memory, and are never stored.',
  'The one thing kept on your device is your saved signatures, in this browser only and never sent anywhere. You can delete them any time from the Signature dialog.',
];

/** Shortcuts, the privacy explanation and recent timings. Opened by "?" and by the privacy note in the header. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dlg}
      aria-label="Help"
      onClose={onClose}
      onClick={(e) => e.target === dlg.current && onClose()}
      className="yh-dialog yh-dialog-form"
    >
      {open && (
        <div className="p-6 space-y-6 overflow-auto max-h-[calc(100dvh-64px)]">
          <section aria-labelledby="help-privacy">
            <div className="flex items-center gap-2 text-accent">
              <Icon name="lock" size={20} />
              <h2 id="help-privacy" className="text-xl leading-7 font-semibold text-text">
                Your files stay on this device
              </h2>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {PRIVACY.map((p) => (
                <li key={p} className="flex gap-2.5">
                  <span className="mt-0.5 text-success">
                    <Icon name="check" size={16} />
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="help-keys">
            <h2 id="help-keys" className="text-[17px] leading-6 font-semibold">
              Keyboard shortcuts
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-[13px] text-text">{k}</dt>
                  <dd className="text-text-muted">{d}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="text-xs text-text-muted">
            <p className="mb-3">
              Free software under the AGPL-3.0.{' '}
              <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="text-accent underline">
                Source code
              </a>
            </p>
            <Hud />
          </section>

          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose} className="px-5">
              Close
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}
