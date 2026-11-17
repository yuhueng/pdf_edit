import { StaticCanvas } from "fabric";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { canShareFile, saveBlob, shareFile } from "../../lib/download.ts";
import type { Edit, PageRef, PdfApi } from "../../lib/pdf/types.ts";
import type { FieldValues, FormField, PageSpec } from "../../lib/pdf/pages.ts";
import type { TextReplacement } from "../../lib/pdf/textEdit.ts";
import { closePdf, openPdf, renderPage } from "../../lib/render.ts";
import { prepareFile } from "../Password.tsx";
import { ChangeReview } from "../ChangeReview.tsx";
import { Button, IconButton, Notice, TextField } from "../kit.tsx";
import { EmptyDrop } from "../DropFiles.tsx";
import { pdfsOnly } from "../dropEvents.ts";
import { PageBar } from "../kit.tsx";
import { useMedia } from "../useMedia.ts";
import { ContextBar } from "./ContextBar.tsx";
import {
  HIGHLIGHT_BUTTONS,
  SHAPE_BUTTONS,
  TOOL_BUTTONS,
  ToolRail,
} from "./ToolRail.tsx";
import { toast } from "../Toasts.tsx";
import { FabricLayer, type FabricLayerHandle } from "./FabricLayer.tsx";
import { checkFields } from "../../lib/pdf/formState.ts";
import { FormOverlay, FormPanel, formSummaryText } from "./FormPanel.tsx";
import { PageStrip } from "./PageStrip.tsx";
import { SignatureDialog } from "./SignatureDialog.tsx";
import { usePinch } from "../usePinch.ts";
import { toEdits } from "./toEdits.ts";
import {
  hexToRgb,
  loadTextHits,
  sampleColor,
  stdFont,
  type FamilyKey,
  type TextHit,
} from "./textHits.ts";
import {
  DEFAULT_STYLE,
  createDateStamp,
  createImageObject,
  imageFileToObject,
  type DrawStyle,
  type EditorTool,
} from "./tools.ts";

type EditorProps = {
  api: PdfApi;
  /** A PDF handed over from Merge / Split. */
  /** False while another tab is showing, so shortcuts do not act on a hidden editor. */
  active?: boolean;
  incoming?: File | null;
  onIncomingUsed?: () => void;
};

/** A pending replacement of existing text, with what the overlay needs to preview it. */
type Rep = {
  key: string;
  original: string;
  rep: TextReplacement;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  family: FamilyKey;
  bold: boolean;
  italic: boolean;
  colorHex: string;
};

type Draft = {
  hit: TextHit;
  text: string;
  family: FamilyKey;
  size: number;
  bold: boolean;
  italic: boolean;
  colorHex: string;
};

/** Everything undo / redo restores: the document (page ops replace the file), overlays, text edits, form values. */
type Snap = {
  file: File;
  pageCount: number;
  fabric: Record<number, Record<string, unknown>>;
  reps: Rep[];
  fields: FieldValues;
  pageIndex: number;
};
const NO_REPS: Rep[] = [];
const NO_FIELDS: FieldValues = {};
const MAX_HISTORY = 100;
const PHONE_POPUP =
  "m-0 yh-fade-in fixed inset-x-0 bottom-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom)+56px)] z-[var(--z-dropdown)] max-h-[40dvh] overflow-auto rounded-t-xl border-t border-border bg-surface shadow-[0_-8px_24px_rgba(27,27,25,0.08)]";

function PhonePopupDialog({
  title,
  onDone,
  children,
}: {
  title: string;
  onDone: () => void;
  children: React.ReactNode;
}) {
  return (
    <div role="dialog" aria-label={title} className={`${PHONE_POPUP} space-y-3 p-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] leading-6 font-semibold">{title}</h2>
        <Button variant="ghost" size="md" onClick={onDone}>
          Done
        </Button>
      </div>
      {children}
    </div>
  );
}

const CSS_FAMILY: Record<FamilyKey, string> = {
  sans: "Helvetica, Arial, sans-serif",
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
};

const EDITOR_DOC_KEY = "editor-active";

export function Editor({
  api,
  active = true,
  incoming,
  onIncomingUsed,
}: EditorProps) {
  const [docInfo, setDocInfo] = useState<{
    file: File;
    name: string;
    pageCount: number;
  } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [wantsImmersive, setImmersive] = useState(false); // phones: the editor takes the whole screen
  const [renderedKey, setRenderedKey] = useState("");
  const [pageSizePt, setPageSizePt] = useState<{
    width: number;
    height: number;
  }>({ width: 595, height: 842 });
  const [tool, setTool] = useState<EditorTool>("select");
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_STYLE);
  const [hasSelection, setHasSelection] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectionKind, setSelectionKind] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pagesSheet, setPagesSheet] = useState(false);
  const [editText, setEditText] = useState(false);
  const [hits, setHits] = useState<TextHit[]>([]);
  const [reps, setReps] = useState<Rep[]>(NO_REPS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fields, setFields] = useState<FieldValues>(NO_FIELDS);
  /** null until "Detect form fields" has run on the current file. */
  const [docRev, setDocRev] = useState(0);
  const phone = useMedia("(max-width: 639px)");
  const immersive = wantsImmersive && phone;
  const [formFields, setFormFields] = useState<FormField[] | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewInfo, setReviewInfo] = useState<{
    pages: number[];
    objects: number;
  }>({ pages: [], objects: 0 });
  const proxyRef = useRef<PDFDocumentProxy | null>(null);
  const [savedOut, setSavedOut] = useState<{
    blob: Blob;
    filename: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const viewportWrapRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  usePinch(
    viewportWrapRef,
    () => viewportWrapRef.current?.firstElementChild as HTMLElement | null,
    (f) =>
      setZoom((z) => Math.min(4, Math.max(0.5, Math.round(z * f * 100) / 100))),
  );
  /** Zoom that makes a page `widthPt` wide fill the canvas area's inner width (its padding excluded), never wider. */
  const fitZoom = (widthPt: number): number => {
    const wrap = viewportWrapRef.current;
    let availW: number;
    if (wrap?.clientWidth) {
      const cs = getComputedStyle(wrap);
      availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
    } else {
      availW = phone ? window.innerWidth - 8 : Math.min(760, window.innerWidth - 56);
    }
    return Math.min(4, Math.max(0.5, Math.floor((availW / widthPt) * 100) / 100));
  };
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<FabricLayerHandle | null>(null);
  const pageCacheRef = useRef<Map<number, Record<string, unknown>>>(new Map());

  // ---- Undo / redo: a stack of full snapshots (cheap: pages and files are shared by reference). ----
  const saveRef = useRef<() => void>(() => {});
  const hist = useRef<{ stack: Snap[]; i: number }>({ stack: [], i: -1 });
  const [histInfo, setHistInfo] = useState<{
    i: number;
    len: number;
    orig: File | null;
  }>({ i: -1, len: 0, orig: null });
  const syncHist = () =>
    setHistInfo({
      i: hist.current.i,
      len: hist.current.stack.length,
      orig: hist.current.stack[0]?.file ?? null,
    });
  const live = useRef({ docInfo, reps, fields, pageIndex });
  useEffect(() => {
    live.current = { docInfo, reps, fields, pageIndex };
  });

  const capture = (): Snap | null => {
    const L = live.current;
    if (!L.docInfo) return null;
    const cur = fabricRef.current?.snapshot();
    if (cur) pageCacheRef.current.set(L.pageIndex, cur);
    return {
      file: L.docInfo.file,
      pageCount: L.docInfo.pageCount,
      fabric: Object.fromEntries(pageCacheRef.current),
      reps: L.reps,
      fields: L.fields,
      pageIndex: L.pageIndex,
    };
  };
  const pushSnap = (snap: Snap) => {
    const h = hist.current;
    h.stack = [...h.stack.slice(0, h.i + 1), snap].slice(-MAX_HISTORY);
    h.i = h.stack.length - 1;
    syncHist();
  };
  const record = () => {
    const snap = capture();
    if (snap) pushSnap(snap);
  };
  const canUndo = histInfo.i > 0;
  const canRedo = histInfo.i < histInfo.len - 1;

  useEffect(() => {
    return () => closePdf(EDITOR_DOC_KEY);
  }, []);

  // "Clear all now" drops the open document and every pending change.
  useEffect(() => {
    const onClear = () => {
      closePdf(EDITOR_DOC_KEY);
      pageCacheRef.current.clear();
      proxyRef.current = null;
      setDocInfo(null);
      setSavedOut(null);
      setReps(NO_REPS);
      setFields(NO_FIELDS);
      setDraft(null);
      setEditText(false);
      hist.current = { stack: [], i: -1 };
      syncHist();
    };
    window.addEventListener("yh:clear", onClear);
    return () => window.removeEventListener("yh:clear", onClear);
  }, []);

  useEffect(() => {
    const wantRuns = editText || tool === "highlightText";
    if (!docInfo || !wantRuns || !proxyRef.current) return;
    let alive = true;
    void loadTextHits(proxyRef.current, pageIndex).then((h) => {
      if (!alive) return;
      if (h === null) {
        if (editText) {
          toast(
            "Editing existing text is not available on rotated pages yet.",
            "info",
          );
          setEditText(false);
        } else {
          toast(
            "Highlight text is not available on rotated pages. Use Highlight area.",
            "info",
          );
          setTool("select");
        }
      } else {
        setHits(h);
        if (tool === "highlightText" && h.length === 0) {
          toast(
            "No selectable text on this page (it may be a scan). Use Highlight area.",
            "info",
          );
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [docInfo, editText, tool, pageIndex]);

  const drawCurrentPage = useCallback(
    async (idx: number, z: number) => {
      if (!docInfo || !pdfCanvasRef.current) return;
      setRenderedKey("");
      const vp1 = await renderPage(
        EDITOR_DOC_KEY,
        idx,
        pdfCanvasRef.current,
        z,
      );
      setPageSizePt({ width: vp1.width, height: vp1.height });
      setRenderedKey(`${idx}:${z}`);
    },
    [docInfo],
  );

  useEffect(() => {
    if (!docInfo) return;
    void fabricRef.current?.restore(
      pageCacheRef.current.get(pageIndex) ?? null,
    );
  }, [docInfo, pageIndex]);

  useEffect(() => {
    if (!docInfo) return;
    void drawCurrentPage(pageIndex, zoom);
  }, [docInfo, pageIndex, zoom, drawCurrentPage]);

  /** Shows `file` in the editor. `resetEdits` drops overlays and text edits (a fresh file, or edits just baked in). */
  const loadDoc = async (
    file: File,
    pageCount: number,
    pi: number,
    resetEdits: boolean,
    fit: boolean,
  ) => {
    closePdf(EDITOR_DOC_KEY);
    const proxy = await openPdf(file, EDITOR_DOC_KEY);
    proxyRef.current = proxy;
    if (resetEdits) {
      pageCacheRef.current.clear();
      setReps(NO_REPS);
      setFields(NO_FIELDS);
    }
    setDraft(null);
    setEditText(false);
    setHits([]);
    setFormFields(null);
    const p = await proxy.getPage(pi + 1);
    const vp = p.getViewport({ scale: 1 });
    if (fit) {
      setZoom(fitZoom(vp.width));
    }
    setPageSizePt({ width: vp.width, height: vp.height });
    setPageIndex(pi);
    setSavedOut(null);
    setDocRev((r) => r + 1);
    setDocInfo({ file, name: file.name, pageCount });
  };

  const openEditorFile = async (orig: File) => {
    const res = await prepareFile(api, orig);
    if (!res) return;
    await loadDoc(res.file, res.pageCount, 0, true, true);
    hist.current = { stack: [], i: -1 };
    pushSnap({
      file: res.file,
      pageCount: res.pageCount,
      fabric: {},
      reps: NO_REPS,
      fields: NO_FIELDS,
      pageIndex: 0,
    });
  };

  const goTo = async (idx: number) => {
    const h = hist.current;
    const snap = h.stack[idx];
    if (!snap) return;
    h.i = idx;
    syncHist();
    setDraft(null);
    const pi = Math.min(snap.pageIndex, snap.pageCount - 1);
    pageCacheRef.current = new Map(
      Object.entries(snap.fabric).map(([k, v]) => [Number(k), v]),
    );
    if (live.current.docInfo && snap.file !== live.current.docInfo.file) {
      await loadDoc(snap.file, snap.pageCount, pi, false, false);
    } else {
      setPageIndex(pi);
      await fabricRef.current?.restore(pageCacheRef.current.get(pi) ?? null);
    }
    setReps(snap.reps);
    setFields(snap.fields);
  };
  const undo = () => void goTo(hist.current.i - 1);
  const redo = () => void goTo(hist.current.i + 1);

  // Text edits and form values record themselves when they change (undo/redo restore the very
  // same objects, so they are recognised and not recorded again).
  useEffect(() => {
    const top = hist.current.stack[hist.current.i];
    if (!top || (top.reps === reps && top.fields === fields)) return;
    record();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps, fields]);

  // Tool shortcuts and Delete/Esc; ignored while typing (inputs, or the Fabric hidden textarea).
  useEffect(() => {
    if (!docInfo || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      )
        return;
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        saveRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key)) {
        const ed = fabricRef.current?.getCanvas()?.getActiveObject() as
          | { isEditing?: boolean }
          | undefined;
        if (ed?.isEditing) return; // typing inside a text object keeps the browser's own undo
        e.preventDefault();
        if (e.key.toLowerCase() === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // WebKit may not report Fabric's hidden textarea as the target; trust Fabric's own editing flag too.
      const active = fabricRef.current?.getCanvas()?.getActiveObject() as
        | { isEditing?: boolean }
        | undefined;
      if (active?.isEditing) return;
      // With the Text tool active, letters are typed text (WebKit may not report Fabric's textarea as target).
      if (e.key === "Escape") setTool("select");
      else if (tool === "text") return;
      else if (e.key === "Delete" || e.key === "Backspace")
        fabricRef.current?.deleteSelected();
      else {
        const hit = [
          ...TOOL_BUTTONS,
          ...HIGHLIGHT_BUTTONS,
          ...SHAPE_BUTTONS,
        ].find((b) => b.key.toLowerCase() === e.key.toLowerCase());
        if (hit) setTool(hit.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docInfo, tool, active, editText]);

  useEffect(() => {
    if (!incoming) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openEditorFile(incoming).finally(() => onIncomingUsed?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const startDraft = (hit: TextHit) => {
    const existing = reps.find((r) => r.key === hit.key);
    setDraft({
      hit,
      text: existing?.rep.text ?? hit.str,
      family: existing?.family ?? hit.family,
      size: existing?.rep.size ?? hit.size,
      bold: existing?.bold ?? hit.bold,
      italic: existing?.italic ?? hit.italic,
      colorHex:
        existing?.colorHex ??
        (pdfCanvasRef.current
          ? sampleColor(pdfCanvasRef.current, hit, zoom)
          : "#000000"),
    });
  };

  const applyDraft = () => {
    if (!draft) return;
    const { hit } = draft;
    if (
      draft.text === hit.str &&
      draft.size === hit.size &&
      !reps.some((r) => r.key === hit.key)
    ) {
      // Nothing about the text itself changed; only restyling still needs a replacement.
      if (
        draft.family === hit.family &&
        draft.bold === hit.bold &&
        draft.italic === hit.italic
      ) {
        setDraft(null);
        return;
      }
    }
    const rep: Rep = {
      key: hit.key,
      original: hit.str,
      rep: {
        page: hit.page,
        box: hit.box,
        x: hit.x,
        y: hit.y,
        text: draft.text,
        font: stdFont(draft.family, draft.bold, draft.italic),
        size: draft.size,
        color: hexToRgb(draft.colorHex),
      },
      vx: hit.vx,
      vy: hit.vy,
      vw: Math.max(hit.vw, draft.text.length * draft.size * 0.5),
      vh: hit.vh,
      family: draft.family,
      bold: draft.bold,
      italic: draft.italic,
      colorHex: draft.colorHex,
    };
    setReps((prev) => [...prev.filter((r) => r.key !== hit.key), rep]);
    setDraft(null);
  };

  // Pages touched by anything that will be written on Save.
  const changedPages = (): number[] => {
    const set = new Set<number>(reps.map((r) => r.rep.page));
    for (const [p, json] of pageCacheRef.current) {
      const objs = (json as { objects?: unknown[] }).objects;
      if (Array.isArray(objs) && objs.length > 0) set.add(p);
    }
    for (const k of Object.keys(fields)) set.add(Number(k.split(":")[0]));
    return [...set].sort((a, b) => a - b);
  };

  // Rotate / reorder / delete replace the file, so a different file than the one opened means pages changed.
  const pagesChanged =
    !!docInfo && !!histInfo.orig && docInfo.file !== histInfo.orig;

  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const reviewSummary =
    [
      pagesChanged && "Pages were rotated, reordered or deleted",
      reviewInfo.pages.length > 0 &&
        n(reviewInfo.pages.length, "page") + " with edits",
      reps.length > 0 && n(reps.length, "text edit"),
      Object.keys(fields).length > 0 &&
        n(Object.keys(fields).length, "form value"),
      reviewInfo.objects > 0 && n(reviewInfo.objects, "added object"),
    ]
      .filter(Boolean)
      .join(" · ") || "No changes.";

  const openReview = () => {
    const snap = fabricRef.current?.snapshot();
    if (snap) pageCacheRef.current.set(pageIndex, snap);
    const pages = changedPages();
    if (pages.length === 0 && !pagesChanged) {
      setReviewInfo({ pages: [], objects: 0 });
      setReviewOpen(true); // the review says "Nothing to be reviewed"
      return;
    }
    let objects = 0;
    for (const j of pageCacheRef.current.values())
      objects += (j as { objects?: unknown[] }).objects?.length ?? 0;
    setReviewInfo({ pages, objects });
    setReviewOpen(true);
  };

  const switchPage = async (nextIdx: number) => {
    if (!docInfo) return;
    setDraft(null);
    const clamped = Math.max(0, Math.min(docInfo.pageCount - 1, nextIdx));
    if (clamped === pageIndex) return;
    const snap = fabricRef.current?.snapshot();
    if (snap) pageCacheRef.current.set(pageIndex, snap);
    setPageIndex(clamped);
  };

  const handleFitWidth = () => {
    if (pageSizePt.width > 0) setZoom(fitZoom(pageSizePt.width));
  };

  const handleStyleChange = (patch: Partial<DrawStyle>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
    fabricRef.current?.applyStyleToSelection(patch);
  };

  const handleInsertSignature = async (dataUrl: string) => {
    try {
      const img = await createImageObject(
        dataUrl,
        "image/png",
        pageSizePt.width,
      );
      fabricRef.current?.addObject(img);
      setTool("select");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to insert signature",
        "error",
      );
    }
  };

  const handleInsertImage = async (file: File) => {
    try {
      const img = await imageFileToObject(file, pageSizePt.width);
      fabricRef.current?.addObject(img);
      setTool("select");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Image insert failed",
        "error",
      );
    }
  };

  /** The document with every pending change written in: form values, text edits, drawings. */
  const buildOutput = async (): Promise<Uint8Array> => {
    if (!docInfo) throw new Error("No document open");
    const currentSnap = fabricRef.current?.snapshot();
    if (currentSnap) pageCacheRef.current.set(pageIndex, currentSnap);

    const proxy = await openPdf(docInfo.file, EDITOR_DOC_KEY);
    const allEdits: Edit[] = [];
    const staticCanvas = new StaticCanvas(undefined, {
      width: 100,
      height: 100,
    });
    try {
      for (let p = 0; p < docInfo.pageCount; p++) {
        const json = pageCacheRef.current.get(p);
        const objs = (json as { objects?: unknown[] } | undefined)?.objects;
        if (!json || !Array.isArray(objs) || objs.length === 0) continue;

        const pdfPage = await proxy.getPage(p + 1);
        const vp1 = pdfPage.getViewport({ scale: 1 });
        staticCanvas.clear();
        staticCanvas.setDimensions({ width: vp1.width, height: vp1.height });
        await staticCanvas.loadFromJSON(json);
        allEdits.push(
          ...toEdits(staticCanvas.getObjects(), p, vp1, pdfPage.rotate),
        );
      }
    } finally {
      await staticCanvas.dispose().catch(() => {});
    }

    let outBytes: Uint8Array = new Uint8Array(await docInfo.file.arrayBuffer());
    if (Object.keys(fields).length > 0)
      outBytes = await api.fillForm(outBytes, fields);
    if (reps.length > 0)
      outBytes = await api.replaceText(
        outBytes,
        reps.map((r) => r.rep),
      );
    if (allEdits.length > 0)
      outBytes = await api.applyEdits(outBytes, allEdits);
    return outBytes;
  };

  const reportError = (err: unknown, fallback: string) => {
    const e = err as Error & { chars?: string[] };
    if (e.name === "UnsupportedTextError" && Array.isArray(e.chars)) {
      toast(`Unsupported non-Latin1 characters: ${e.chars.join(" ")}`, "error");
    } else {
      toast(e.message || fallback, "error");
    }
  };

  const handleSave = async () => {
    if (!docInfo) return;
    setReviewOpen(false);
    setSaving(true);
    try {
      const outBytes = await buildOutput();
      const filename = `${docInfo.name.replace(/.pdf$/i, "")}-edited.pdf`;
      const blob = new Blob([outBytes as Uint8Array<ArrayBuffer>], {
        type: "application/pdf",
      });
      setSavedOut({ blob, filename });
      saveBlob(blob, filename);
      toast(`Saved ${filename}`, "success");
    } catch (err) {
      reportError(err, "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const detectFields = async () => {
    if (!docInfo) return;
    setSaving(true);
    try {
      const found = await api.formFields(
        new Uint8Array(await docInfo.file.arrayBuffer()),
      );
      setFormFields(found);
      toast(
        found.length === 0
          ? "No form fields found in this PDF."
          : `Found ${found.length} form field${found.length === 1 ? "" : "s"}.`,
        found.length ? "success" : "info",
      );
    } catch (err) {
      reportError(err, "Could not read the form fields");
    } finally {
      setSaving(false);
    }
  };

  const jumpToField = async (f: FormField) => {
    await switchPage(f.page);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="field-${CSS.escape(f.name)}"] :is(input,select,textarea)`,
      );
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    }, 250);
  };

  const checkFilled = () => {
    if (!formFields) return;
    const sum = checkFields(formFields, fields);
    if (sum.total === 0) toast("This PDF has no fields to fill.", "info");
    else if (sum.empty.length === 0)
      toast(`All ${sum.total} fields are filled.`, "success");
    else {
      toast(
        `${sum.empty.length} of ${sum.total} fields still empty: ${sum.empty
          .map((x) => x.name)
          .slice(0, 5)
          .join(", ")}${sum.empty.length > 5 ? "…" : ""}`,
        "error",
      );
      void jumpToField(sum.empty[0]!);
    }
  };

  /** Rotate / reorder / delete: the pending changes are written into the file first, then the pages are reshaped. */
  const reshapePages = async (specs: PageSpec[], keepPage: number) => {
    if (!docInfo || saving) return;
    setSaving(true);
    try {
      const baked = await buildOutput();
      const out = await api.reshape(baked, specs);
      const file = new File([out as Uint8Array<ArrayBuffer>], docInfo.name, {
        type: "application/pdf",
      });
      const pi = Math.max(0, Math.min(specs.length - 1, keepPage));
      await loadDoc(file, specs.length, pi, true, false);
      pushSnap({
        file,
        pageCount: specs.length,
        fabric: {},
        reps: NO_REPS,
        fields: NO_FIELDS,
        pageIndex: pi,
      });
    } catch (err) {
      reportError(err, "Could not change the pages");
    } finally {
      setSaving(false);
    }
  };

  // Full screen on a phone: the tab bar is hidden by a flag on <html> (see index.css); the app header (help, Clear all) stays.
  useEffect(() => {
    const root = document.documentElement;
    if (immersive && active && phone) root.dataset.immersive = "true";
    else delete root.dataset.immersive;
    const onFs = () => {
      if (!document.fullscreenElement) setImmersive(false); // the system gesture left full screen
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      delete root.dataset.immersive;
    };
  }, [immersive, active, phone]);
  const toggleImmersive = () => {
    const on = !immersive;
    setImmersive(on);
    if (on) {
      handleFitWidth();
      // Android browsers can hide their own bars too; iOS ignores this, the flag above still hides ours.
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const zoomGroup = (
    <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
      <IconButton
        icon="zoomOut"
        label="Zoom out"
        onClick={() =>
          setZoom((z) => Math.max(0.5, Math.floor((z - 0.01) * 4) / 4))
        }
      />
      <button
        type="button"
        onClick={() => setZoom(1)}
        className="min-h-9 w-14 max-sm:w-11 rounded-md text-center font-mono text-[13px] tabular-nums hover:bg-surface-sunken [@media(pointer:coarse)]:min-h-10"
        title="Reset to 100%"
        aria-label="Zoom level"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton
        icon="zoomIn"
        label="Zoom in"
        onClick={() =>
          setZoom((z) => Math.min(4, Math.ceil((z + 0.01) * 4) / 4))
        }
      />
      {phone ? (
        <IconButton
          icon={immersive ? "compress" : "fit"}
          label={immersive ? "Exit full screen" : "Full screen"}
          onClick={toggleImmersive}
        />
      ) : (
        <IconButton
          icon="fit"
          label="Fit"
          tip="Fit to width"
          onClick={handleFitWidth}
        />
      )}
    </div>
  );

  const historyGroup = (
    <div
      role="group"
      aria-label="History"
      className="flex items-center gap-0.5"
    >
      <IconButton
        icon="undo"
        label="Undo"
        shortcut="Ctrl+Z"
        disabled={!canUndo || saving}
        onClick={undo}
      />
      <IconButton
        icon="redo"
        label="Redo"
        shortcut="Ctrl+Y"
        disabled={!canRedo || saving}
        onClick={redo}
      />
    </div>
  );

  const pagesEl = docInfo ? (
    <PageStrip
      docKey={EDITOR_DOC_KEY}
      pageCount={docInfo.pageCount}
      rev={docRev}
      current={pageIndex}
      busy={saving}
      layout={phone ? "row" : "column"}
      onSelect={(i) => void switchPage(i)}
      onReshape={(specs, keep) => void reshapePages(specs, keep)}
    />
  ) : null;

  const formEl = (
    <FormPanel
      showSummary={!phone}
      compact={phone}
      fields={formFields}
      values={fields}
      busy={saving}
      onDetect={() => void detectFields()}
      onJump={(f) => void jumpToField(f)}
      onCheck={checkFilled}
    />
  );

  const formStrip =
    phone && !immersive && formFields ? (
      <p
        role="status"
        data-testid="form-summary"
        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs"
      >
        {formSummaryText(formFields, fields)}
      </p>
    ) : null;

  const openPicker = () => fileInputRef.current?.click();
  useEffect(() => {
    saveRef.current = openReview;
  });

  const rail = (orientation: "vertical" | "horizontal") => (
    <ToolRail
      orientation={orientation}
      tool={tool}
      onTool={(t) => {
        setTool(t);
        setEditText(false);
        setDraft(null);
        if (phone) setFormOpen(false);
        setPagesSheet(false);
      }}
      editText={editText}
      onEditText={() => {
        setEditText((v) => !v);
        setDraft(null);
        setTool("select");
        if (phone) setFormOpen(false);
        setPagesSheet(false);
      }}
      onImage={() => imgInputRef.current?.click()}
      onSignature={() => setSigOpen(true)}
      onDateStamp={() => {
        fabricRef.current?.addObject(createDateStamp(40, 40, style));
        setTool("select");
      }}
      formOpen={formOpen}
      onForm={() => {
        setFormOpen((o) => !o);
        if (phone) {
          setPagesSheet(false);
          setEditText(false);
          setDraft(null);
          setTool("select");
        }
      }}
      pagesOpen={pagesSheet}
      onPages={
        orientation === "horizontal"
          ? () => {
              setPagesSheet((o) => !o);
              setFormOpen(false);
              setEditText(false);
              setDraft(null);
              setTool("select");
            }
          : undefined
      }
    />
  );

  const context = (
    <ContextBar
      tool={tool}
      style={style}
      hasSelection={hasSelection}
      selectionKind={selectionKind}
      onChange={handleStyleChange}
      onBringFront={() => fabricRef.current?.bringFront()}
      onSendBack={() => fabricRef.current?.sendBack()}
      onDelete={() => fabricRef.current?.deleteSelected()}
    />
  );
  // Select and Hand are the neutral tools: neither opens a settings panel on its own.
  const hasContext = (tool !== "select" && tool !== "hand") || hasSelection;
  const phonePopupOpen = phone && (hasContext || !!draft || formOpen || pagesSheet || editText);
  // The phone settings panel is titled after the tool (or the selected object) and closed with Done.
  const KIND_LABEL: Record<string, string> = { text: "Text", highlight: "Highlight", draw: "Draw", shape: "Shape", image: "Image" };
  const contextTitle =
    tool !== "select" && tool !== "hand"
      ? ([...TOOL_BUTTONS, ...HIGHLIGHT_BUTTONS, ...SHAPE_BUTTONS].find((b) => b.id === tool)?.label ?? "Tool")
      : (KIND_LABEL[selectionKind ?? ""] ?? "Selection");
  const doneTool = () => {
    fabricRef.current?.deselect();
    setTool("select");
  };

  return (
    <div className={`space-y-5 ${phonePopupOpen ? "max-sm:pb-[40dvh]" : "max-sm:pb-20"}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="editor-file-input"
        data-yh-add="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void openEditorFile(f);
            e.target.value = "";
          }
        }}
      />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        data-testid="editor-image-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void handleInsertImage(f);
            e.target.value = "";
          }
        }}
      />

      {docInfo ? (
        <h1 className="sr-only">Edit</h1>
      ) : (
        <PageBar title="Edit" description="Add text, highlights, shapes, signatures and more." />
      )}

      {!docInfo ? (
        <EmptyDrop
          icon="edit"
          title="Open a PDF to edit"
          hint="Add text, highlights, shapes, signatures and more."
          chooseLabel="Choose a PDF"
          onFiles={(f) => {
            const pdf = pdfsOnly(f)[0];
            if (pdf) void openEditorFile(pdf);
          }}
          onChoose={openPicker}
        />
      ) : (
        <>
          {typeof window !== "undefined" && window.innerWidth < 360 && !immersive && (
            <Notice kind="info">Editing works best on a larger screen.</Notice>
          )}

          {/* Top bar: file and pages on the left, history and zoom in the middle, Save on the right. */}
          <div className={`sticky top-14 z-[var(--z-sticky)] -mx-4 border-b border-border bg-[rgba(246,245,241,0.95)] px-4 py-2 backdrop-blur-sm sm:top-[var(--header-h)] sm:-mx-6 sm:px-6`}>
            <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-center gap-1 max-sm:flex-1">
                <IconButton
                  icon="folder"
                  label="Open another PDF"
                  onClick={openPicker}
                />
                <span
                  className="max-w-[40vw] truncate text-sm font-medium sm:max-w-[260px]"
                  title={docInfo.name}
                >
                  {docInfo.name}
                </span>
              </div>
              <div className="flex items-center gap-x-4 max-sm:order-3 max-sm:w-full max-sm:justify-between max-sm:gap-0">
                <div className="flex items-center gap-0.5">
                  <IconButton
                    icon="prev"
                    label="Prev"
                    tip="Previous page"
                    disabled={pageIndex <= 0}
                    onClick={() => void switchPage(pageIndex - 1)}
                  />
                  {phone ? (
                    <span className="text-[13px] tabular-nums">
                      {pageIndex + 1}/{docInfo.pageCount}
                    </span>
                  ) : (
                    <>
                      <input
                        type="number"
                        aria-label="Current page"
                        min={1}
                        max={docInfo.pageCount}
                        value={pageIndex + 1}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n))
                            void switchPage(Math.round(n) - 1);
                        }}
                        className="min-h-9 w-14 rounded-md border border-border-strong bg-surface px-1.5 text-center text-sm tabular-nums"
                      />
                      <span className="px-1 text-xs text-text-muted tabular-nums">
                        / {docInfo.pageCount}
                      </span>
                    </>
                  )}
                  <IconButton
                    icon="next"
                    label="Next"
                    tip="Next page"
                    disabled={pageIndex >= docInfo.pageCount - 1}
                    onClick={() => void switchPage(pageIndex + 1)}
                  />
                </div>
                {historyGroup}
                {zoomGroup}
              </div>
              <div className="ml-auto flex items-center gap-2 max-sm:order-2">
                {savedOut && canShareFile(savedOut.blob, savedOut.filename) && (
                  <Button
                    icon="share"
                    onClick={() =>
                      void shareFile(savedOut.blob, savedOut.filename)
                    }
                  >
                    Share
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="md"
                  icon="save"
                  aria-label="Save PDF"
                  loading={saving}
                  loadingLabel="Saving…"
                  onClick={openReview}
                >
                  {phone ? "Save" : "Save PDF"}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            {!phone && (
              <div className="sticky top-[calc(var(--header-h)+80px)] z-[var(--z-dropdown)] shrink-0">
                {rail("vertical")}
              </div>
            )}

            {!phone && (
              <aside
                aria-label="Pages"
                className="sticky top-[calc(var(--header-h)+80px)] max-h-[calc(100dvh-var(--header-h)-120px)] w-44 shrink-0 overflow-y-auto rounded-xl border border-border bg-surface p-2"
              >
                {pagesEl}
              </aside>
            )}

            <div className="min-w-0 flex-1 space-y-3">
              {!phone && (
                <div className="rounded-xl border border-border bg-surface px-3">
                  {context}
                </div>
              )}

              {editText && !draft && !phone && (
                <Notice kind="info">
                  Click any outlined text on the page to change its words, font,
                  size or colour. The original text is removed from the file.
                </Notice>
              )}
              {draft && (
                <div
                  role="group"
                  aria-label="Edit existing text"
                  className={
                    phone
                      ? `${PHONE_POPUP} space-y-3 p-3`
                      : "space-y-3 rounded-xl border border-accent bg-surface p-4"
                  }
                >
                  {phone && (
                    <div className="flex items-center justify-between">
                      <h2 className="text-[15px] leading-6 font-semibold">Replace text</h2>
                      <Button variant="ghost" size="md" onClick={applyDraft}>
                        Done
                      </Button>
                    </div>
                  )}
                  <TextField
                    label="Replacement text"
                    aria-label="Replacement text"
                    value={draft.text}
                    onChange={(e) =>
                      setDraft({ ...draft, text: e.target.value })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <select
                      aria-label="Text font"
                      value={draft.family}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          family: e.target.value as FamilyKey,
                        })
                      }
                      className="min-h-9 rounded-md border border-border-strong bg-surface px-2 [@media(pointer:coarse)]:min-h-10"
                    >
                      <option value="sans">Sans (Helvetica)</option>
                      <option value="serif">Serif (Times)</option>
                      <option value="mono">Mono (Courier)</option>
                    </select>
                    <input
                      type="number"
                      aria-label="Text size"
                      min={6}
                      max={96}
                      value={draft.size}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          size: Math.max(
                            6,
                            Number(e.target.value) || draft.size,
                          ),
                        })
                      }
                      className="min-h-9 w-16 rounded-md border border-border-strong bg-surface px-2 tabular-nums [@media(pointer:coarse)]:min-h-10"
                    />
                    <Button
                      size="md"
                      variant={draft.bold ? "primary" : "secondary"}
                      aria-pressed={draft.bold}
                      aria-label="Bold"
                      className="min-w-9 font-bold"
                      onClick={() => setDraft({ ...draft, bold: !draft.bold })}
                    >
                      B
                    </Button>
                    <Button
                      size="md"
                      variant={draft.italic ? "primary" : "secondary"}
                      aria-pressed={draft.italic}
                      aria-label="Italic"
                      className="min-w-9 italic"
                      onClick={() =>
                        setDraft({ ...draft, italic: !draft.italic })
                      }
                    >
                      I
                    </Button>
                    <input
                      type="color"
                      aria-label="Text colour"
                      value={draft.colorHex}
                      onChange={(e) =>
                        setDraft({ ...draft, colorHex: e.target.value })
                      }
                      className="h-9 w-9 cursor-pointer rounded-md border border-border-strong p-0.5"
                    />
                    <Button
                      size="md"
                      onClick={() =>
                        setDraft({ ...draft, size: 24, bold: true })
                      }
                    >
                      Heading 1
                    </Button>
                    <Button
                      size="md"
                      onClick={() =>
                        setDraft({ ...draft, size: 18, bold: true })
                      }
                    >
                      Heading 2
                    </Button>
                    <Button
                      size="md"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          size: draft.hit.size,
                          bold: false,
                          italic: false,
                        })
                      }
                    >
                      Body
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!phone && (
                      <Button
                        variant="primary"
                        onClick={applyDraft}
                        className="px-5"
                      >
                        Apply
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                    {reps.some((r) => r.key === draft.hit.key) && (
                      <Button
                        variant="destructive-ghost"
                        onClick={() => {
                          setReps((prev) =>
                            prev.filter((r) => r.key !== draft.hit.key),
                          );
                          setDraft(null);
                        }}
                      >
                        Revert to original
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {formStrip}

              {/* The one place that scrolls on its own: the page canvas. Phones: edge to edge, thin padding. */}
              <div
                ref={viewportWrapRef}
                data-testid="page-viewport"
                // Hand with a mouse: drag to scroll (touch scrolls natively, the drawing layer lets touches through).
                onPointerDown={(e) => {
                  if (tool !== "hand" || e.pointerType !== "mouse" || e.button !== 0) return;
                  const w = e.currentTarget;
                  panRef.current = { x: e.clientX, y: e.clientY, left: w.scrollLeft, top: w.scrollTop };
                  w.setPointerCapture(e.pointerId);
                  e.preventDefault();
                }}
                onPointerMove={(e) => {
                  const p0 = panRef.current;
                  if (!p0) return;
                  e.currentTarget.scrollLeft = p0.left - (e.clientX - p0.x);
                  e.currentTarget.scrollTop = p0.top - (e.clientY - p0.y);
                }}
                onPointerUp={() => (panRef.current = null)}
                onPointerCancel={() => (panRef.current = null)}
                className={`flex max-h-[calc(100dvh-var(--header-h)-170px)] touch-pan-x touch-pan-y overflow-auto rounded-xl bg-surface-sunken p-4 max-sm:-mx-4 max-sm:rounded-none max-sm:px-1 max-sm:pt-1 ${immersive ? "max-sm:max-h-[calc(100dvh-186px)]" : ""} ${tool === "hand" ? "cursor-grab active:cursor-grabbing" : ""} ${phonePopupOpen ? "max-sm:pb-[45dvh]" : "max-sm:pb-28"}`}
              >
                {/* mx-auto, not justify-center: centred when it fits, and both edges stay reachable when zoomed wider. */}
                <div
                  className="relative isolate mx-auto shrink-0 bg-white shadow-2"
                  style={{
                    width: Math.ceil(pageSizePt.width * zoom),
                    height: Math.ceil(pageSizePt.height * zoom),
                  }}
                >
                  <canvas
                    ref={pdfCanvasRef}
                    data-rendered={renderedKey}
                    className="block"
                  />
                  <FabricLayer
                    ref={fabricRef}
                    widthPt={pageSizePt.width}
                    heightPt={pageSizePt.height}
                    zoom={zoom}
                    tool={tool}
                    style={style}
                    runs={hits}
                    onChange={record}
                    onToolChange={setTool}
                    onSelectionChange={(sel) => {
                      setHasSelection(sel.hasSelection);
                      setSelectionKind(
                        sel.hasSelection ? (sel.kind ?? null) : null,
                      );
                      if (sel.stylePatch)
                        setStyle((prev) => ({ ...prev, ...sel.stylePatch }));
                      if (sel.hasSelection && phone) {
                        setPagesSheet(false);
                        setFormOpen(false);
                      }
                    }}
                  />
                  {reps
                    .filter((r) => r.rep.page === pageIndex)
                    .map((r) => (
                      <div
                        key={r.key}
                        aria-hidden="true"
                        data-testid="text-replacement"
                        className="pointer-events-none absolute overflow-hidden whitespace-nowrap bg-white"
                        style={{
                          left: r.vx * zoom,
                          top: r.vy * zoom,
                          width: r.vw * zoom,
                          height: r.vh * zoom,
                          color: r.colorHex,
                          fontFamily: CSS_FAMILY[r.family],
                          fontWeight: r.bold ? 700 : 400,
                          fontStyle: r.italic ? "italic" : "normal",
                          fontSize: r.rep.size * zoom,
                          lineHeight: `${r.vh * zoom}px`,
                        }}
                      >
                        {r.rep.text}
                      </div>
                    ))}
                  {formFields && (
                    <FormOverlay
                      fields={formFields}
                      page={pageIndex}
                      zoom={zoom}
                      values={fields}
                      onChange={(patch) =>
                        setFields((prev) => ({ ...prev, ...patch }))
                      }
                    />
                  )}
                  {editText && (
                    <div className="pointer-events-none absolute inset-0 z-20">
                      {hits.map((h) => (
                        <button
                          key={h.key}
                          type="button"
                          aria-label={`Edit text: ${h.str}`}
                          onClick={() => startDraft(h)}
                          className="pointer-events-auto absolute cursor-text border border-dashed border-accent/70 hover:bg-accent/15"
                          style={{
                            left: h.vx * zoom,
                            top: h.vy * zoom,
                            width: h.vw * zoom,
                            height: h.vh * zoom,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!phone && formOpen && (
              <aside
                aria-label="Form fields"
                className="sticky top-[calc(var(--header-h)+80px)] w-80 shrink-0"
              >
                {formEl}
              </aside>
            )}
          </div>

          {/* Phones: tools in a toolbar at the bottom, and tool settings, pages and forms in docked bottom popups above it. */}
          {phone && (
            <>
              {hasContext && !draft && !formOpen && !pagesSheet && (
                <PhonePopupDialog title={contextTitle} onDone={doneTool}>
                  {context}
                </PhonePopupDialog>
              )}
              {editText && !draft && !formOpen && !pagesSheet && !hasContext && (
                <PhonePopupDialog title="Edit text" onDone={() => setEditText(false)}>
                  <p className="text-sm text-text-muted">Tap outlined text to change it.</p>
                </PhonePopupDialog>
              )}
              {pagesSheet && (
                <PhonePopupDialog title="Pages" onDone={() => setPagesSheet(false)}>
                  {pagesEl}
                </PhonePopupDialog>
              )}
              {formOpen && (
                <PhonePopupDialog title="Form fields" onDone={() => setFormOpen(false)}>
                  {formEl}
                </PhonePopupDialog>
              )}
              <div className="m-0 fixed inset-x-0 bottom-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom))] z-[var(--z-dropdown)] flex h-14 items-center border-t border-border bg-surface">
                {rail("horizontal")}
              </div>
            </>
          )}

          <ChangeReview
            open={reviewOpen}
            title="Review before saving"
            summary={reviewSummary}
            extra={
              reps.length > 0 ? (
                <section>
                  <h3 className="text-sm font-semibold">
                    Text changes ({reps.length})
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {reps.map((r) => (
                      <li
                        key={r.key}
                        className="flex flex-wrap items-baseline gap-2"
                      >
                        <span className="text-xs text-text-muted">
                          p.{r.rep.page + 1}
                        </span>
                        <del className="rounded-xs bg-danger-tint px-1 text-danger">
                          {r.original}
                        </del>
                        <ins className="rounded-xs bg-success-tint px-1 text-success no-underline">
                          {r.rep.text}
                        </ins>
                        <span className="text-xs text-text-muted">
                          {r.rep.font} {r.rep.size}pt
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : pagesChanged && reviewInfo.pages.length === 0 ? (
                <p className="text-sm text-text-muted">
                  The new page order and rotation are shown in the page list
                  beside the editor. The saved file follows it.
                </p>
              ) : null
            }
            sections={[
              ...(reviewInfo.pages.length === 0
                ? []
                : [
                    {
                      title: "Pages with edits",
                      hint: "Thumbnails show the original page; badges mark where edits land.",
                      tiles: reviewInfo.pages.map((p) => ({
                        key: `e-${p}`,
                        page: {
                          id: `e-${p}`,
                          fileId: EDITOR_DOC_KEY,
                          srcIndex: p,
                          rotation: 0,
                        } as PageRef,
                        edited: true,
                      })),
                    },
                  ]),
            ]}
            confirmLabel="Confirm and save"
            nothing={reviewInfo.pages.length === 0 && !pagesChanged}
            busy={saving}
            onCancel={() => setReviewOpen(false)}
            onConfirm={() => void handleSave()}
            caption={(pg) => `Page ${pg.srcIndex + 1}`}
          />

          <SignatureDialog
            open={sigOpen}
            onClose={() => setSigOpen(false)}
            onInsert={(url) => void handleInsertSignature(url)}
          />
        </>
      )}
    </div>
  );
}
