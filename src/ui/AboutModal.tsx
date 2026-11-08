'use client';
/**
 * About (P7): what the app is, the framing sentence (docs/02-plan.md line 7, verbatim), what it is
 * not, and links. A native <dialog> opened with showModal(): the browser makes the rest of the
 * page inert (focus stays inside) and Esc fires `cancel`. Esc is also handled on keydown and the
 * opener gets focus back explicitly, so the behaviour doesn't depend on the browser (or the test
 * DOM) implementing all of that. Neutral styling; no company names, logos or colours.
 */
import { useEffect, useRef, useState } from 'react';

export const REPO_URL = 'https://github.com/Wenze0614/blast-movement-viewer';
export const AUTHOR = 'Wenze Zhang';
export const AUTHOR_URL = 'https://github.com/Wenze0614';

/** docs/02-plan.md line 7, verbatim. */
export const FRAMING =
  "This is the front end and API I'd build around a blast-movement engine. The movement model is a deliberately simple stand-in for the engine's output; the showcase is the visualisation, the interaction and the data plumbing.";

export const WHAT_THIS_IS_NOT: readonly string[] = [
  'Not physics: block movement comes from a simple, seeded heuristic, not a blast simulation, and it is not calibrated against any mine.',
  'Synthetic data: the block model, grades and the three demo blasts are generated.',
  'The adjusted dig line is a grade-threshold contour on the post-blast model, not an optimised dig limit.',
  'Blasthole grades are derived from the block model here; in reality blasthole samples feed the grade-control model.',
  'Dilution is defined differently from site to site; this app uses waste tonnes sent to the mill ÷ total mill tonnes.',
  'Not affiliated with any company or product.',
];

interface AboutModalProps {
  open: boolean;
  onClose(): void;
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="about-title"
      className="m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-surface p-5 text-sm text-foreground shadow-xl backdrop:bg-black/60"
      onCancel={(e) => {
        e.preventDefault(); // we close through state, so React and the element stay in sync
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop click
      }}
    >
      {open ? (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h2 id="about-title" className="text-base font-semibold">
              About Blast Movement Viewer
            </h2>
            <button
              type="button"
              autoFocus
              className="rounded border border-border px-2 py-0.5 text-xs hover:border-accent"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <p>
            A concept prototype exploring blast movement visualisation. A synthetic gold bench is blasted with a heuristic
            movement model; the app animates every block from its in-situ position to the muckpile and compares ore loss
            and dilution for the original and the movement-adjusted dig lines.
          </p>
          <blockquote className="border-l-2 border-accent pl-3 italic">{FRAMING}</blockquote>
          <section aria-labelledby="about-not">
            <h3 id="about-not" className="mb-1 font-semibold">
              What this is not
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              {WHAT_THIS_IS_NOT.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <p className="text-muted">
            Built by {AUTHOR} ·{' '}
            <a className="underline hover:text-accent" href={REPO_URL} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>{' '}
            ·{' '}
            <a className="underline hover:text-accent" href={AUTHOR_URL} target="_blank" rel="noreferrer">
              {AUTHOR} on GitHub
            </a>
          </p>
        </div>
      ) : null}
    </dialog>
  );
}

/** Panel-header button + modal; focus returns to the button when the modal closes. */
export default function AboutButton() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        About
      </button>
      <AboutModal open={open} onClose={close} />
    </>
  );
}
