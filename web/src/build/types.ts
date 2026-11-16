export type PreviewGlyph = [adv: number, x: number, y: number, w: number, h: number, px: string] | null;
export type Preview = { ascent: number; descent: number; lines: { lang: string; text: string; glyphs: PreviewGlyph[] }[] };

export type BuildRequest = { firmware: ArrayBuffer; langs: string[]; glyphs: Record<string, string>; lines: [lang: string, text: string][]; indexURL: string };
export type BuildResponse =
  | { type: "log"; msg: string }
  | { type: "done"; image: ArrayBuffer; sha256: string; versionOk: boolean; preview: Preview }
  | { type: "error"; message: string };
