"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

/**
 * Click/tap-to-toggle help tooltip. Designed for touch (iPhone) — no
 * hover required. Dismisses on outside click, Esc key, or re-clicking
 * the anchor.
 *
 * Renders as a small inline `HelpCircle` icon button next to the
 * field label; the popover is positioned absolutely beneath the icon.
 */
export function Tooltip({ content, label }: { content: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="tooltip-anchor" ref={wrapRef}>
      <button
        type="button"
        className="help-icon"
        aria-label={label ? `Help: ${label}` : "Help"}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span className="tooltip-popover" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
