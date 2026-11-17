import { useEffect } from 'react';
import { Icon, type IconName } from './kit.tsx';

/** The tools, in the order of the app's tabs. `route` is the tab's link. */
const TOOLS: Array<{ n: string; name: string; route: string; icon: IconName; text: string; detail: string }> = [
  {
    n: '01',
    name: 'Split & Merge',
    route: 'split',
    icon: 'layers',
    text: 'Combine PDFs, reorder, rotate or delete pages, take out page ranges, or split every page into its own file.',
    detail: 'Many files · page ranges · ZIP',
  },
  {
    n: '02',
    name: 'Compress',
    route: 'compress',
    icon: 'compress',
    text: 'Shrink files to an upload limit. Lossless clean-up first, then images re-encoded; text scans become crisp black and white.',
    detail: 'Flate · JPEG · CCITT G4',
  },
  {
    n: '03',
    name: 'Encrypt & Decrypt',
    route: 'encrypt',
    icon: 'lock',
    text: 'Lock a PDF with a password, or remove a password you know.',
    detail: 'AES-256',
  },
  {
    n: '04',
    name: 'Convert',
    route: 'convert',
    icon: 'convert',
    text: 'Turn pages into PNG images or into styled HTML.',
    detail: 'PNG · HTML',
  },
  {
    n: '05',
    name: 'Edit',
    route: 'edit',
    icon: 'edit',
    text: 'Add text, drawings, highlights, shapes, images, dates and signatures. Saved signatures stay on this device.',
    detail: 'Text · shapes · signatures',
  },
];

const FACTS: Array<{ k: string; v: string }> = [
  { k: 'Uploads', v: 'None. Files are read and written in your browser.' },
  { k: 'Account', v: 'Not needed. Open it and start.' },
  { k: 'Offline', v: 'Installable, and works without a connection once loaded.' },
];

/** Corner crop marks, like the trim marks on a printed proof. */
function CropMarks() {
  const mark = 'absolute h-5 w-5 border-text/35';
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-3 sm:inset-5">
      <span className={`${mark} left-0 top-0 border-l border-t`} />
      <span className={`${mark} right-0 top-0 border-r border-t`} />
      <span className={`${mark} bottom-0 left-0 border-b border-l`} />
      <span className={`${mark} bottom-0 right-0 border-b border-r`} />
    </span>
  );
}

/** Three sheets that fan out on load: the stack a merge starts from. Decorative. */
function SheetStack() {
  const lines = (n: number, short: number) =>
    Array.from({ length: n }, (_, i) => (
      <span key={i} className="block h-[5px] rounded-pill bg-thumb-line" style={{ width: i === short ? '58%' : i % 3 === 2 ? '84%' : '100%' }} />
    ));
  return (
    <div aria-hidden="true" className="yh-stack relative mx-auto h-[300px] w-[230px] sm:h-[360px] sm:w-[276px]">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="yh-sheet absolute inset-0 flex flex-col gap-2.5 rounded-[3px] border border-border bg-surface p-6 shadow-3"
          style={{ ['--i' as string]: i }}
        >
          <span className="mb-1 block h-2.5 w-1/2 rounded-pill bg-thumb-heading" />
          {lines(i === 2 ? 9 : 7, i === 2 ? 4 : 6)}
          {i === 2 && (
            <>
              <span className="mt-2 block h-16 rounded-sm bg-accent-tint" />
              {lines(4, 3)}
              <span className="mt-auto flex items-end justify-between">
                <span className="font-display text-[26px] italic leading-none text-accent">Signed</span>
                <span className="font-mono text-[10px] text-text-muted">p. 1/3</span>
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * First screen for a new visitor (or one not seen in 24 hours): what the app does, in print-proof style.
 * `onStart(route)` opens a tool.
 */
export function Landing({ onStart }: { onStart: (route: string) => void }) {
  useEffect(() => {
    document.title = 'YH PDF Edit · PDF tools that stay on your device';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="yh-landing min-h-screen bg-bg text-text" data-testid="landing">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4 sm:h-20 sm:px-8">
        <span className="flex items-baseline">
          <span className="font-display text-[30px] leading-none">YH</span>
          <span className="ml-2.5 text-[15px] font-semibold">PDF Edit</span>
        </span>
        <button
          type="button"
          onClick={() => onStart('split')}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-text"
        >
          Open the app <Icon name="next" size={14} />
        </button>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-[1200px] px-4 sm:px-8">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-muted px-5 py-12 sm:px-12 sm:py-16 lg:py-20">
            <CropMarks />
            <div className="grid items-center gap-12 lg:grid-cols-[1.25fr_1fr]">
              <div>
                <p className="yh-rise font-mono text-[12px] uppercase tracking-[0.14em] text-text-muted" style={{ ['--d' as string]: 0 }}>
                  PDF tools · in your browser
                </p>
                <h1
                  className="yh-rise mt-5 font-display text-[44px] leading-[1.02] tracking-[-0.01em] sm:text-[64px] lg:text-[80px]"
                  style={{ ['--d' as string]: 1 }}
                >
                  Every PDF job,
                  <br />
                  <em className="text-accent">done on your own device.</em>
                </h1>
                <p className="yh-rise mt-6 max-w-[52ch] text-[17px] leading-relaxed text-text-secondary" style={{ ['--d' as string]: 2 }}>
                  Merge, split, compress, encrypt, convert and edit PDFs. Nothing is uploaded: your files never leave this computer.
                </p>
                <div className="yh-rise mt-9 flex flex-wrap items-center gap-x-6 gap-y-4" style={{ ['--d' as string]: 3 }}>
                  <button
                    type="button"
                    onClick={() => onStart('split')}
                    className="group inline-flex min-h-13 items-center gap-2.5 rounded-pill bg-accent px-7 text-[16px] font-semibold text-text-on-accent shadow-2 transition-[background-color,transform] duration-150 hover:bg-accent-hover active:translate-y-px active:bg-accent-pressed focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    Get started
                    <span className="transition-transform duration-200 ease-[var(--ease-standard)] group-hover:translate-x-1">
                      <Icon name="next" size={18} />
                    </span>
                  </button>
                  <span className="font-mono text-[12px] text-text-muted">No account · Free · Up to 1.5 GB per file</span>
                </div>
              </div>
              <SheetStack />
            </div>
          </div>
        </section>

        {/* Contents: the tools, like a document's table of contents */}
        <section aria-labelledby="contents" className="mx-auto w-full max-w-[1200px] px-4 pt-16 sm:px-8 sm:pt-24">
          <div className="flex items-baseline justify-between border-b border-text pb-3">
            <h2 id="contents" className="font-display text-[32px] leading-none sm:text-[40px]">
              Contents
            </h2>
            <span className="font-mono text-[12px] text-text-muted">5 tools</span>
          </div>
          <ol>
            {TOOLS.map((t) => (
              <li key={t.route} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => onStart(t.route)}
                  aria-label={`Open ${t.name}`}
                  className="group grid w-full grid-cols-[44px_1fr_auto] items-start gap-x-4 py-6 text-left transition-colors duration-150 hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none sm:grid-cols-[72px_minmax(0,260px)_1fr_auto] sm:items-baseline sm:gap-x-8 sm:px-2"
                >
                  <span className="font-display text-[28px] leading-none text-text-muted transition-colors duration-150 group-hover:text-accent sm:text-[36px]">
                    {t.n}
                  </span>
                  <span className="flex items-center gap-2.5 text-[19px] font-semibold sm:text-[21px]">
                    <Icon name={t.icon} size={18} className="text-accent" />
                    {t.name}
                  </span>
                  <span className="col-start-2 mt-2 text-[15px] leading-relaxed text-text-secondary sm:col-start-3 sm:mt-0">
                    {t.text}
                    <span className="mt-1.5 block font-mono text-[11.5px] tracking-wide text-text-muted">{t.detail}</span>
                  </span>
                  <span className="row-start-1 col-start-3 self-center text-text-muted transition-[color,transform] duration-200 group-hover:translate-x-1 group-hover:text-accent sm:col-start-4">
                    <Icon name="next" size={18} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        {/* How it stays private */}
        <section aria-labelledby="private" className="mx-auto w-full max-w-[1200px] px-4 pt-16 sm:px-8 sm:pt-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <h2 id="private" className="font-display text-[32px] leading-[1.08] sm:text-[44px]">
              Private <em className="text-accent">by design,</em>
              <br />
              not by promise.
            </h2>
            <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              {FACTS.map((f) => (
                <div key={f.k} className="bg-surface p-5 sm:p-6">
                  <dt className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-text-muted">{f.k}</dt>
                  <dd className="mt-3 text-[15px] leading-relaxed">{f.v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="mt-12 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-display text-[24px] italic leading-tight text-text-secondary sm:text-[28px]">Ready when your PDF is.</p>
            <button
              type="button"
              onClick={() => onStart('split')}
              className="inline-flex min-h-12 items-center gap-2 rounded-pill border border-text px-6 text-[15px] font-semibold transition-colors duration-150 hover:bg-text hover:text-bg focus-visible:shadow-focus focus-visible:outline-none"
            >
              Get started <Icon name="next" size={16} />
            </button>
          </div>
        </section>
      </main>

      {/* Colophon: the small print */}
      <footer className="mx-auto mt-16 w-full max-w-[1200px] px-4 pb-10 sm:mt-24 sm:px-8">
        <div className="border-t border-border pt-5 text-[12px] leading-relaxed text-text-muted">
          <p className="max-w-[90ch]">
            Provided as is, without warranty. Keep a copy of your originals. Speed and the largest file that works depend on your
            device. A lost password cannot be recovered. Encrypt, Convert and some edits download the PDF engine once.
          </p>
          <p className="mt-3 font-mono text-[11px]">YH PDF Edit</p>
        </div>
      </footer>
    </div>
  );
}
