// The wizard's screens and which of the four steps each belongs to (from the prototype).
export type Screen =
  | "choose" | "fwEmpty" | "fwChecking" | "fwValid" | "fwWrong"
  | "prep" | "searching" | "pairing" | "connected" | "mismatch"
  | "transfer" | "installing" | "done" | "lost"
  | "unsupported" | "recovery";

export const STEP: Partial<Record<Screen, number>> = {
  choose: 0, fwEmpty: 1, fwChecking: 1, fwValid: 1, fwWrong: 1,
  prep: 2, searching: 2, pairing: 2, connected: 2, mismatch: 2,
  transfer: 3, installing: 3, done: 3, lost: 3,
};

export const STEP_LABELS = ["Choose languages", "Get the firmware", "Connect watch", "Install"];
