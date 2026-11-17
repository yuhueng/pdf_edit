import { highlightRects, type TextHit } from './textHits.ts';
import { Canvas, IText, Path, PencilBrush, type FabricObject } from 'fabric';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import {
  CUSTOM_PROPS,
  FONT_STACKS,
  buildShapePath,
  createTextObject,
  type DrawStyle,
  type EditorTool,
  type FontFamilyKey,
  type TaggedObj,
} from './tools.ts';

export type FabricLayerHandle = {
  getCanvas(): Canvas | null;
  snapshot(): Record<string, unknown> | null;
  restore(json: Record<string, unknown> | null): Promise<void>;
  addObject(obj: FabricObject): void;
  applyStyleToSelection(patch: Partial<DrawStyle>): void;
  bringFront(): void;
  sendBack(): void;
  deleteSelected(): void;
  deselect(): void;
};

type FabricLayerProps = {
  ref?: Ref<FabricLayerHandle>;
  widthPt: number;
  heightPt: number;
  zoom: number;
  tool: EditorTool;
  style: DrawStyle;
  onToolChange: (tool: EditorTool) => void;
  /** Text runs of this page (scale-1 viewport units), for the Highlight text tool. */
  runs?: Array<Pick<TextHit, 'str' | 'vx' | 'vy' | 'vw' | 'vh'>>;
  /** Fires once after the drawing changes (added, moved, edited, removed), coalesced per tick. */
  onChange?: () => void;
  onSelectionChange: (sel: { hasSelection: boolean; isText: boolean; kind?: string; stylePatch?: Partial<DrawStyle> }) => void;
};

function fontKeyFromStack(family: string | undefined): FontFamilyKey {
  if (!family) return 'sans';
  if (/times|serif/i.test(family)) return 'serif';
  if (/courier|mono/i.test(family)) return 'mono';
  return 'sans';
}

export function FabricLayer({
  ref,
  widthPt,
  heightPt,
  zoom,
  tool,
  style,
  onToolChange,
  runs,
  onChange,
  onSelectionChange,
}: FabricLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const toolRef = useRef(tool);
  const styleRef = useRef(style);
  const onToolChangeRef = useRef(onToolChange);
  const onSelRef = useRef(onSelectionChange);
  const runsRef = useRef(runs);
  const onChangeRef = useRef(onChange);
  const quiet = useRef(0); // >0 while restoring a snapshot: not a user change

  useEffect(() => {
    toolRef.current = tool;
    styleRef.current = style;
    onToolChangeRef.current = onToolChange;
    onSelRef.current = onSelectionChange;
    runsRef.current = runs;
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = '';
    const el = document.createElement('canvas');
    host.appendChild(el);

    const fc = new Canvas(el, {
      selection: true,
      preserveObjectStacking: true,
    });
    canvasRef.current = fc;

    const notifySelection = () => {
      const active = fc.getActiveObject();
      if (!active) {
        onSelRef.current({ hasSelection: false, isText: false });
        return;
      }
      if (active instanceof IText || active.type === 'i-text') {
        const it = active as IText & TaggedObj;
        onSelRef.current({
          hasSelection: true,
          isText: true,
          kind: 'text',
          stylePatch: {
            stroke: typeof it.fill === 'string' ? it.fill : '#111827',
            opacity: it.opacity ?? 1,
            fontFamily: it.yhFamily ?? fontKeyFromStack(it.fontFamily),
            fontSize: it.fontSize ?? 14,
            bold: it.fontWeight === 'bold',
            italic: it.fontStyle === 'italic',
            underline: Boolean(it.underline),
            strike: Boolean(it.linethrough),
          },
        });
      } else {
        onSelRef.current({
          hasSelection: true,
          isText: false,
          kind: (active as TaggedObj).yhKind ?? 'shape',
          stylePatch: {
            ...((active as TaggedObj).yhKind === 'highlight' && typeof active.fill === 'string' ? { highlight: active.fill } : {}),
            stroke: typeof active.stroke === 'string' ? active.stroke : styleRef.current.stroke,
            fill: typeof active.fill === 'string' && active.fill !== 'transparent' ? active.fill : null,
            strokeWidth: active.strokeWidth ?? styleRef.current.strokeWidth,
            opacity: active.opacity ?? 1,
          },
        });
      }
    };

    let pendingChange = false;
    const changed = (e?: { target?: FabricObject }) => {
      if (quiet.current > 0 || e?.target?.excludeFromExport) return; // previews are not changes
      if (pendingChange) return;
      pendingChange = true;
      queueMicrotask(() => {
        pendingChange = false;
        onChangeRef.current?.();
      });
    };
    fc.on('object:added', changed);
    fc.on('object:removed', changed);
    fc.on('object:modified', changed);
    fc.on('text:editing:exited', () => changed());

    fc.on('selection:created', notifySelection);
    fc.on('selection:updated', notifySelection);
    fc.on('selection:cleared', notifySelection);

    fc.on('path:created', (e) => {
      const p = e.path as Path & TaggedObj;
      p.yhKind = 'draw';
      p.opacity = styleRef.current.opacity;
    });

    let dragStart: { x: number; y: number } | null = null;
    let preview: Path | null = null;

    fc.on('mouse:down', (opt) => {
      const curTool = toolRef.current;
      if (curTool === 'select' || curTool === 'hand' || curTool === 'draw') return;
      const pt = fc.getScenePoint(opt.e);
      if (curTool === 'text') {
        if (opt.target) return;
        const tObj = createTextObject(pt.x, pt.y, 'Text', styleRef.current);
        fc.add(tObj);
        fc.setActiveObject(tObj);
        tObj.enterEditing();
        tObj.selectAll();
        fc.requestRenderAll();
        onToolChangeRef.current('select');
        return;
      }
      dragStart = { x: pt.x, y: pt.y };
      preview = buildShapePath(curTool === 'highlightText' ? 'highlight' : curTool, pt.x, pt.y, pt.x + 1, pt.y + 1, styleRef.current);
      preview.selectable = false;
      preview.evented = false;
      preview.excludeFromExport = true;
      fc.add(preview);
    });

    fc.on('mouse:move', (opt) => {
      if (!dragStart || !preview) return;
      const curTool = toolRef.current;
      if (curTool === 'select' || curTool === 'hand' || curTool === 'draw' || curTool === 'text') return;
      const pt = fc.getScenePoint(opt.e);
      fc.remove(preview);
      preview = buildShapePath(curTool === 'highlightText' ? 'highlight' : curTool, dragStart.x, dragStart.y, pt.x, pt.y, styleRef.current);
      preview.selectable = false;
      preview.evented = false;
      preview.excludeFromExport = true;
      fc.add(preview);
      fc.requestRenderAll();
    });

    fc.on('mouse:up', (opt) => {
      if (!dragStart || !preview) return;
      const curTool = toolRef.current;
      const pt = fc.getScenePoint(opt.e);
      const dist = Math.hypot(pt.x - dragStart.x, pt.y - dragStart.y);
      fc.remove(preview);
      if (dist >= 3 && curTool === 'highlightText') {
        // Several rectangles in one tick count as one change for undo.
        const rects = highlightRects(runsRef.current ?? [], { x1: dragStart.x, y1: dragStart.y, x2: pt.x, y2: pt.y });
        for (const r of rects) fc.add(buildShapePath('highlight', r.x, r.y, r.x + r.w, r.y + r.h, styleRef.current));
      } else if (dist >= 3 && (curTool === 'highlight' || curTool === 'rect' || curTool === 'ellipse' || curTool === 'line' || curTool === 'arrow')) {
        const finalShape = buildShapePath(curTool, dragStart.x, dragStart.y, pt.x, pt.y, styleRef.current);
        fc.add(finalShape);
        fc.setActiveObject(finalShape);
      }
      dragStart = null;
      preview = null;
      fc.requestRenderAll();
    });

    return () => {
      canvasRef.current = null;
      void fc.dispose().catch(() => {});
      host.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    const fc = canvasRef.current;
    if (!fc || widthPt <= 0 || heightPt <= 0) return;
    fc.setZoom(zoom);
    fc.setDimensions({ width: Math.ceil(widthPt * zoom), height: Math.ceil(heightPt * zoom) });
    fc.requestRenderAll();
  }, [widthPt, heightPt, zoom]);

  useEffect(() => {
    const fc = canvasRef.current;
    if (!fc) return;
    const isDraw = tool === 'draw';
    fc.isDrawingMode = isDraw;
    fc.selection = tool === 'select';
    if (tool === 'hand') fc.discardActiveObject(); // no selection handles left over while moving the page
    fc.forEachObject((o) => {
      o.selectable = tool === 'select';
      o.evented = tool === 'select';
    });
    if (isDraw) {
      const brush = new PencilBrush(fc);
      brush.decimate = 0.4;
      brush.color = style.stroke;
      brush.width = style.strokeWidth;
      fc.freeDrawingBrush = brush;
    }
    fc.requestRenderAll();
  }, [tool, style.stroke, style.strokeWidth]);

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    snapshot: () => {
      const fc = canvasRef.current;
      if (!fc) return null;
      return fc.toObject([...CUSTOM_PROPS]) as Record<string, unknown>;
    },
    restore: async (json) => {
      const fc = canvasRef.current;
      if (!fc) return;
      quiet.current++;
      fc.clear();
      if (json && Array.isArray((json as { objects?: unknown[] }).objects) && (json as { objects: unknown[] }).objects.length > 0) {
        await fc.loadFromJSON(json);
      }
      fc.forEachObject((o) => {
        o.selectable = toolRef.current === 'select';
        o.evented = toolRef.current === 'select';
      });
      fc.requestRenderAll();
      queueMicrotask(() => quiet.current--);
    },
    addObject: (obj) => {
      const fc = canvasRef.current;
      if (!fc) return;
      fc.add(obj);
      fc.setActiveObject(obj);
      fc.requestRenderAll();
    },
    applyStyleToSelection: (patch) => {
      const fc = canvasRef.current;
      if (!fc) return;
      const active = fc.getActiveObject();
      if (!active) return;
      if (active instanceof IText || active.type === 'i-text') {
        const it = active as IText & TaggedObj;
        if (patch.stroke !== undefined) it.set('fill', patch.stroke);
        if (patch.opacity !== undefined) it.set('opacity', patch.opacity);
        if (patch.fontFamily !== undefined) {
          it.yhFamily = patch.fontFamily;
          it.set('fontFamily', FONT_STACKS[patch.fontFamily]);
        }
        if (patch.fontSize !== undefined) it.set('fontSize', patch.fontSize);
        if (patch.bold !== undefined) it.set('fontWeight', patch.bold ? 'bold' : 'normal');
        if (patch.italic !== undefined) it.set('fontStyle', patch.italic ? 'italic' : 'normal');
        if (patch.underline !== undefined) it.set('underline', patch.underline);
        if (patch.strike !== undefined) it.set('linethrough', patch.strike);
      } else {
        if ((active as TaggedObj).yhKind === 'highlight') {
          if (patch.highlight !== undefined) active.set('fill', patch.highlight);
          if (patch.hlOpacity !== undefined) active.set('opacity', patch.hlOpacity);
          fc.requestRenderAll();
          return;
        }
        if (patch.stroke !== undefined) active.set('stroke', patch.stroke);
        if (patch.fill !== undefined) active.set('fill', patch.fill);
        if (patch.strokeWidth !== undefined) active.set('strokeWidth', patch.strokeWidth);
        if (patch.opacity !== undefined) active.set('opacity', patch.opacity);
      }
      fc.requestRenderAll();
    },
    bringFront: () => {
      const fc = canvasRef.current;
      const active = fc?.getActiveObject();
      if (fc && active) {
        fc.bringObjectToFront(active);
        fc.requestRenderAll();
      }
    },
    sendBack: () => {
      const fc = canvasRef.current;
      const active = fc?.getActiveObject();
      if (fc && active) {
        fc.sendObjectToBack(active);
        fc.requestRenderAll();
      }
    },
    deselect: () => {
      const fc = canvasRef.current;
      if (!fc) return;
      fc.discardActiveObject();
      fc.requestRenderAll();
    },
    deleteSelected: () => {
      const fc = canvasRef.current;
      if (!fc) return;
      const objs = fc.getActiveObjects();
      if (objs.length === 0) return;
      for (const o of objs) fc.remove(o);
      fc.discardActiveObject();
      fc.requestRenderAll();
    },
  }));

  return (
    <div
      ref={hostRef}
      data-testid="fabric-overlay"
      className="absolute inset-0"
      // Hand: touches and clicks go through to the scrolling page area, so one finger (or a mouse drag) moves the page.
      style={tool === 'hand' ? { pointerEvents: 'none' } : { touchAction: tool === 'select' ? 'auto' : 'none' }}
    />
  );
}
