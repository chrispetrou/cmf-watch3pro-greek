// Next to the title: a grid of empty boxes, the way the watch shows letters it
// doesn't have, that turn into Greek, Georgian and Armenian letters one at a time.
// Decorative only: hidden from screen readers, runs only while on screen, still with reduced motion.
import { useEffect, useRef } from "react";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));
const GLYPHS = [
  ...range(0x3b1, 0x3c9).filter((c) => c !== "ς"), // α-ω
  ...range(0x10d0, 0x10f0), // ა-ჰ
  ...range(0x561, 0x586), // ա-ֆ
];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const CELL = 30; // px per cell, both ways
const TICK = 650; // ms between changes
const FULL = 0.6; // above this share of letters, letters start turning back into boxes

function setCell(el: HTMLElement, letter: string | null, animate: boolean) {
  el.textContent = letter ?? "";
  el.className = letter ? "gf-l" : "gf-b";
  if (animate && letter) {
    el.classList.add("gf-hot");
    // Restart the flip animation even if this cell flipped recently.
    void el.offsetWidth;
    el.classList.add("gf-flip");
    setTimeout(() => el.classList.remove("gf-hot"), 900);
  }
}

/** Fills its parent and fades out at every edge. */
export function GlyphField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cells: HTMLElement[] = [];
    let timer = 0;
    let visible = false;

    const build = () => {
      const cols = Math.max(1, Math.floor(root.clientWidth / CELL));
      const rows = Math.max(1, Math.floor(root.clientHeight / CELL));
      if (cells.length === cols * rows) return;
      root.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      root.replaceChildren();
      cells = Array.from({ length: cols * rows }, () => {
        const el = document.createElement("span");
        setCell(el, Math.random() < (still ? 0.4 : 0.15) ? pick(GLYPHS) : null, false);
        root.append(el);
        return el;
      });
    };

    const tick = () => {
      if (document.hidden || !cells.length) return;
      const letters = cells.filter((c) => c.className.startsWith("gf-l"));
      if (letters.length / cells.length > FULL) setCell(pick(letters), null, false);
      const boxes = cells.filter((c) => c.className === "gf-b");
      if (boxes.length) setCell(pick(boxes), pick(GLYPHS), true);
    };

    const run = () => {
      clearInterval(timer);
      if (visible && !still) timer = window.setInterval(tick, TICK);
    };

    build();
    const ro = new ResizeObserver(build);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); });
    io.observe(root);
    return () => { clearInterval(timer); ro.disconnect(); io.disconnect(); };
  }, []);

  return <div ref={ref} className="gf" aria-hidden="true" />;
}
