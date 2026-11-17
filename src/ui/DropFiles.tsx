import { useDroppable } from '@dnd-kit/core';
import { useState, type ReactNode } from 'react';
import { fmtSize, SHOWN_MAX_BYTES } from '../lib/format.ts';
import { Button, EmptyState, type IconName } from './kit.tsx';

/**
 * A tool's first screen: a large dashed drop zone that is also the call to add a file.
 * Files dropped anywhere on the window reach the tool too, through the shell's overlay.
 */
export function EmptyDrop({
  icon,
  title,
  hint,
  onFiles,
  onChoose,
  chooseLabel = 'Choose PDFs',
  testId,
}: {
  icon: IconName;
  title: string;
  hint: string;
  onFiles: (files: File[]) => void;
  onChoose: () => void;
  chooseLabel?: string;
  testId?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid={testId}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation(); // the zone handles it, so the window overlay must not send it twice
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`flex min-h-[280px] max-sm:mt-4 items-center justify-center rounded-xl border border-dashed transition-[border-color,background-color,transform] duration-150 ${
        over ? 'scale-[1.01] border-solid border-accent bg-accent-tint' : 'border-border-dashed bg-surface/50'
      }`}
    >
      <EmptyState icon={icon} title={title} hint={hint} caption={`PDF only · up to ${fmtSize(SHOWN_MAX_BYTES)} each`}>
        <Button variant="primary" onClick={onChoose} className="mt-1 px-5">
          {chooseLabel}
        </Button>
      </EmptyState>
    </div>
  );
}

/** The slot at the end of the new-files list: dropping a page (or the ticked pages) here starts a new file. */
export function NewFileSlot({ disabled, children }: { disabled?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'split:new', disabled });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border border-dashed px-4 py-5 text-center text-sm transition-[border-color,background-color] duration-150 ${
        isOver && !disabled ? 'border-solid border-accent bg-accent-tint text-text' : 'border-border-dashed text-text-muted'
      }`}
    >
      {children}
    </div>
  );
}
