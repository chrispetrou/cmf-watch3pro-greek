export type BuildRequest = { firmware: ArrayBuffer; langs: string[]; glyphs: Record<string, string>; emoji?: string; indexURL: string };
export type BuildResponse =
  | { type: "log"; msg: string }
  | { type: "done"; image: ArrayBuffer; sha256: string; versionOk: boolean }
  | { type: "error"; message: string };
