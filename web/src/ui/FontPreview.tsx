// Draws sample text with the glyphs decoded from the patched image (white on black, 2 bpp),
// so it shows exactly what the watch will draw. Same layout as tools/render_preview.py.
import { useEffect, useRef } from "react";
import type { Preview } from "../build/types";

const PAD = 20;
const LINE_GAP = -14;

export function FontPreview({ preview, lines }: { preview: Preview; lines: Preview["lines"] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const asc = preview.ascent, desc = Math.abs(preview.descent);
    const lineH = asc + desc + LINE_GAP;
    const width = Math.max(...lines.map((l) => l.glyphs.reduce((n, g) => n + (g ? g[0] : 0), 0))) / 16 + 2 * PAD;
    const height = lines.length * lineH + 2 * PAD - LINE_GAP;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = Math.ceil(width) * dpr;
    canvas.height = height * dpr;
    canvas.style.aspectRatio = `${Math.ceil(width)} / ${height}`;
    canvas.style.width = `min(100%, ${Math.ceil(width)}px)`;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const put = (x: number, y: number, v: number) => {
      for (let dy = 0; dy < dpr; dy++) {
        for (let dx = 0; dx < dpr; dx++) {
          const i = ((y * dpr + dy) * canvas.width + x * dpr + dx) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        }
      }
    };
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255; // opaque black
    lines.forEach((line, row) => {
      let pen = PAD * 16; // 1/16 px
      const baseline = PAD + row * lineH + asc;
      for (const g of line.glyphs) {
        if (!g) continue;
        const [adv, gx, gy, w, h, px] = g;
        const ox = Math.floor(pen / 16) + gx, oy = baseline - gy - h;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const v = px.charCodeAt(y * w + x) - 48;
            if (v && ox + x >= 0 && ox + x < width && oy + y >= 0 && oy + y < height) put(ox + x, oy + y, v * 85);
          }
        }
        pen += adv;
      }
    });
    ctx.putImageData(img, 0, 0);
  }, [preview, lines]);

  return <canvas ref={ref} className="font-preview" role="img" aria-label={lines.map((l) => l.text).join(". ")} />;
}
