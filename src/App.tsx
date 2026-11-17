import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createWorkerApi } from './lib/worker/client.ts';
import { LiveRegion } from './ui/Announcer.tsx';
import { DROP_EVENT, type DropDetail } from './ui/dropEvents.ts';
import { markVisit, shouldShowLanding } from './lib/visit.ts';
import { LAUNCHED_WITH_FILE, onLaunchFile } from './lib/launch.ts';
import { HelpDialog } from './ui/Help.tsx';
import { Landing } from './ui/Landing.tsx';
import { Organize } from './ui/Organize.tsx';
import { PasswordDialog } from './ui/Password.tsx';
import { Toasts } from './ui/Toasts.tsx';
import { Button, Icon, IconButton, Skeleton, type IconName } from './ui/kit.tsx';
// Heavy tools load on first visit (Fabric and the Lab are not needed to merge a PDF), then the browser
// fetches the rest while it is idle so switching tabs is instant.
const loadCompress = () => import('./ui/Compress.tsx');
const loadConvert = () => import('./ui/Convert.tsx');
const loadCrypt = () => import('./ui/Crypt.tsx');
const loadEditor = () => import('./ui/editor/Editor.tsx');
const Compress = lazy(() => loadCompress().then((m) => ({ default: m.Compress })));
const Convert = lazy(() => loadConvert().then((m) => ({ default: m.Convert })));
const Crypt = lazy(() => loadCrypt().then((m) => ({ default: m.Crypt })));
const Editor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })));
function prefetchTools() {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return; // the user asked to save data
  for (const load of [loadCrypt, loadCompress, loadConvert, loadEditor]) void load().catch(() => {});
}
const Lab = lazy(() => import('./ui/Lab.tsx').then((m) => ({ default: m.Lab })));

type Tab = 'organize' | 'crypt' | 'compress' | 'convert' | 'edit' | 'lab';

// The Lab is a test harness, not a product feature: only reachable at /?lab=1 (used by the E2E suite).
const SHOW_LAB = new URLSearchParams(window.location.search).has('lab');

// Each tool has its own link (#/split ...). All tools stay mounted once opened, so switching never loses work.
const TABS: Array<{ id: Tab; label: string; route: string; icon: IconName }> = [
  { id: 'organize', label: 'Split & Merge', route: 'split', icon: 'layers' },
  { id: 'compress', label: 'Compress', route: 'compress', icon: 'compress' },
  { id: 'crypt', label: 'Encrypt & Decrypt', route: 'encrypt', icon: 'lock' },
  { id: 'convert', label: 'Convert', route: 'convert', icon: 'convert' },
  { id: 'edit', label: 'Edit', route: 'edit', icon: 'edit' },
  { id: 'lab', label: 'Lab', route: 'lab', icon: 'check' },
];

const tabFromHash = (): Tab => {
  const r = window.location.hash.replace(/^#\/?/, '');
  return TABS.find((t) => t.route === r && (t.id !== 'lab' || SHOW_LAB))?.id ?? 'organize';
};

/** The pill track: a white pill slides under the active tab (200ms; reduced motion jumps). */
function TabTrack({ tabs, tab }: { tabs: typeof TABS; tab: Tab }) {
  const track = useRef<HTMLElement | null>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = track.current?.querySelector<HTMLElement>('[aria-current="page"]');
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    if (track.current) ro.observe(track.current);
    document.fonts?.ready.then(place).catch(() => {});
    return () => ro.disconnect();
  }, [tab, tabs]);

  return (
    <nav
      ref={track}
      aria-label="Tools"
      className="relative hidden sm:grid grid-flow-col auto-cols-fr items-center justify-self-center gap-0.5 rounded-pill bg-surface-sunken p-1 overflow-x-auto max-w-full"
    >
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-0 rounded-pill bg-surface shadow-1 transition-[transform,width] duration-200 ease-[var(--ease-standard)]"
          style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
        />
      )}
      {tabs.map((t) => (
        <a
          key={t.id}
          href={`#/${t.route}`}
          aria-current={tab === t.id ? 'page' : undefined}
          className={`relative z-10 inline-flex items-center justify-center min-h-9 px-3 rounded-pill text-sm whitespace-nowrap transition-colors duration-150 ${
            tab === t.id ? 'text-text font-semibold' : 'text-text-secondary hover:text-text hover:bg-white/50'
          }`}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * The landing page shows on the bare address (no tool link) when this browser has not visited in 24 hours.
 * Links to a tool (#/compress ...) and the Lab always open the tool.
 */
const landingFirst = (): boolean =>
  !LAUNCHED_WITH_FILE && !window.location.hash.replace(/^#\/?/, '') && !SHOW_LAB && shouldShowLanding();

export default function App() {
  const [landing, setLanding] = useState(landingFirst);
  const [tab, setTabNow] = useState<Tab>(tabFromHash);
  // Tools stay mounted once opened, so their work survives tab switches.
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(() => new Set<Tab>(['organize', tabFromHash()]));
  const [api] = useState(() => createWorkerApi());
  // A PDF produced by Split & Merge, waiting to be opened in Edit.
  const [incoming, setIncoming] = useState<File | null>(null);
  const [help, setHelp] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dropping, setDropping] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const tabs = TABS.filter((t) => t.id !== 'lab' || SHOW_LAB);

  const go = (t: Tab) => {
    const route = TABS.find((x) => x.id === t)!.route;
    if (tabFromHash() !== t) window.location.hash = `#/${route}`;
    else {
      setTabNow(t);
      setSeen((p) => (p.has(t) ? p : new Set(p).add(t)));
    }
  };

  // Any visit counts: the landing page then stays away for 24 hours.
  useEffect(() => markVisit(), []);

  // Browser back/forward and the tab links all go through the hash.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2500));
    idle(prefetchTools);
  }, []);

  useEffect(() => {
    const on = () => {
      const t = tabFromHash();
      setTabNow(t);
      setSeen((p) => (p.has(t) ? p : new Set(p).add(t)));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    if (!landing) document.title = `${TABS.find((t) => t.id === tab)?.label ?? ''} · YH PDF Edit`;
  }, [tab, landing]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  // "?" opens help and Ctrl/Cmd+O adds PDFs; neither fires while typing.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === '?' && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHelp(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        const input = mainRef.current?.querySelector<HTMLInputElement>('[data-panel]:not([hidden]) input[type="file"][data-yh-add]');
        if (input) {
          e.preventDefault();
          input.click();
        }
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // Files dragged anywhere over the window: show the overlay, then hand them to the visible tool.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) window.dispatchEvent(new CustomEvent<DropDetail>(DROP_EVENT, { detail: { tab: tabFromHash(), files } }));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const clearAll = () => {
    window.dispatchEvent(new Event('yh:clear'));
    setIncoming(null);
  };
  const toEdit = (f: File) => {
    setIncoming(f);
    go('edit');
  };

  // A PDF opened with the installed app ("Open with" or Share) goes straight to Edit.
  useEffect(() => {
    onLaunchFile((f) => {
      setLanding(false);
      setIncoming(f);
      window.location.hash = '#/edit';
    });
  }, []);

  const panel = (id: Tab) => ({
    'data-panel': id,
    hidden: tab !== id,
    className: tab === id ? 'yh-fade-up' : undefined,
  });

  if (landing) {
    return (
      <Landing
        onStart={(route) => {
          markVisit();
          setLanding(false);
          window.location.hash = `#/${route}`;
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[var(--z-dialog)] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      <header
        className={`sticky top-0 z-[var(--z-header)] border-b border-border transition-[background-color,box-shadow] duration-200 ${
          scrolled ? 'bg-[rgba(246,245,241,0.92)] backdrop-blur-sm shadow-2' : 'bg-bg'
        }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-[var(--content-max)] items-center justify-between gap-4 px-4 sm:h-[var(--header-h)] sm:px-6 lg:grid lg:grid-cols-[auto_1fr_auto] lg:px-10 xl:grid-cols-[1fr_auto_1fr]">
          <a href="#/split" aria-label="YH PDF Edit, home" className="flex items-baseline shrink-0 lg:justify-self-start">
            <span className="font-display text-[28px] leading-none">YH</span>
            <span className="ml-2.5 text-[15px] font-semibold">
              <span className="max-sm:hidden">PDF Edit</span>
              <span className="sm:hidden">{tabs.find((t) => t.id === tab)?.label ?? 'PDF Edit'}</span>
            </span>
          </a>

          <TabTrack tabs={tabs} tab={tab} />

          <div className="flex items-center gap-1.5 shrink-0 lg:justify-self-end">
            <button
              type="button"
              onClick={() => setHelp(true)}
              className="hidden 2xl:inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 min-h-9 text-[13px] text-text-muted hover:text-text hover:bg-surface-sunken"
            >
              <Icon name="lock" size={14} /> Files stay on this device
            </button>
            {/* Clear all now lives in the header, next to help, on every screen size. */}
            <Button
              variant="destructive-ghost"
              size="md"
              icon="trash"
              aria-label="Clear all now"
              onClick={clearAll}
              className="bg-danger-tint hover:bg-[#f6d9d5] max-sm:!min-h-8 max-sm:!px-2 max-sm:text-xs"
            >
              <span className="hidden xl:inline">Clear all now</span>
              <span className="xl:hidden">Clear all</span>
            </Button>
            <IconButton icon="help" label="Help and shortcuts" tip="Help · ?" onClick={() => setHelp(true)} className="2xl:hidden" />
          </div>
        </div>
      </header>

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={`flex-1 w-full mx-auto outline-none px-4 pt-0 sm:px-6 pb-[calc(var(--bottom-bar-h)+32px)] sm:pb-16 ${
          'max-w-[var(--content-max)] lg:px-10'
        }`}
      >
        {/* All tools stay mounted (hidden) so edits survive tab switches; Clear all / refresh resets them. */}
        <div {...panel('organize')}>
          <Organize api={api} onEdit={toEdit} active={tab === 'organize'} />
        </div>
        <Suspense
          fallback={
            <div role="status" aria-label="Loading" className="space-y-3 py-6">
              <Skeleton className="h-10 w-48" />
              <Skeleton className="h-40" />
            </div>
          }
        >
          {seen.has('crypt') && (
            <div {...panel('crypt')}>
              <Crypt api={api} />
            </div>
          )}
          {seen.has('compress') && (
            <div {...panel('compress')}>
              <Compress api={api} onEdit={toEdit} />
            </div>
          )}
          {seen.has('convert') && (
            <div {...panel('convert')}>
              <Convert api={api} />
            </div>
          )}
          {seen.has('edit') && (
            <div {...panel('edit')}>
              <Editor api={api} active={tab === 'edit'} incoming={incoming} onIncomingUsed={() => setIncoming(null)} />
            </div>
          )}
          {SHOW_LAB && seen.has('lab') && (
            <div {...panel('lab')}>
              <Lab api={api} />
            </div>
          )}
        </Suspense>
      </main>

      {/* Phones: the five tools as a bottom tab bar. */}
      <nav
        data-chrome
        aria-label="Tools"
        className="sm:hidden fixed inset-x-0 bottom-0 z-[var(--z-sheet)] grid border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#/${t.route}`}
            aria-current={tab === t.id ? 'page' : undefined}
            aria-label={t.label}
            title={t.label}
            className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium leading-tight text-center ${
              tab === t.id ? 'text-accent' : 'text-text-muted'
            }`}
          >
            {tab === t.id && <span aria-hidden="true" className="absolute top-0 h-[3px] w-8 rounded-b-sm bg-accent" />}
            <Icon name={t.icon} size={22} />
          </a>
        ))}
      </nav>

      {dropping && (
        <div
          aria-hidden="true"
          className="yh-fade-in pointer-events-none fixed inset-0 z-[var(--z-dialog)] flex items-center justify-center bg-[rgba(246,245,241,0.92)]"
        >
          <div className="absolute inset-4 rounded-2xl border-2 border-dashed border-accent" />
          <p className="relative text-xl font-semibold">Drop PDFs to add them</p>
        </div>
      )}

      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <PasswordDialog />
      <LiveRegion />
      <Toasts />
    </div>
  );
}
