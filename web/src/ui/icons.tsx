// Line icons from the design (24px grid unless noted).
import type { ReactNode } from "react";

type P = { size?: number; width?: number; children?: ReactNode; viewBox?: string };

const Svg = ({ size = 20, width = 1.75, viewBox = "0 0 24 24", children }: P) => (
  <svg width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" strokeWidth={width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const WatchIcon = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="6" /><path d="M9 6.5L9.5 2h5l.5 4.5M9 17.5l.5 4.5h5l.5-4.5M12 9.5V12l1.5 1.5" /></Svg>
);
export const Code = (p: P) => <Svg {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></Svg>;
export const Sun = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>
);
export const Moon = (p: P) => <Svg {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Svg>;
export const Check = (p: P) => <Svg width={2} {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
export const Cross = (p: P) => <Svg width={2} {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const Arrow = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const Lock = (p: P) => <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
export const Download = (p: P) => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;
export const FileUp = (p: P) => (
  <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 17v-6M9 14l3-3 3 3" /></Svg>
);
export const Bluetooth = (p: P) => <Svg {...p}><path d="M7 7l10 10-5 4V3l5 4L7 17" /></Svg>;
export const BluetoothOff = (p: P) => <Svg {...p}><path d="M7 7l10 10-5 4V3l5 4-2 1.6M3 3l18 18" /></Svg>;
export const Warn = (p: P) => <Svg {...p}><path d="M12 3.5l9.5 17h-19z" /><path d="M12 10v4.5M12 17.5v.5" /></Svg>;
export const Retry = (p: P) => <Svg {...p}><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></Svg>;
export const Copy = (p: P) => <Svg {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" /></Svg>;
export const Laptop = (p: P) => <Svg {...p}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></Svg>;
export const Phone = (p: P) => <Svg {...p}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" /></Svg>;
export const Restore = (p: P) => <Svg {...p}><path d="M12 3v10M8 9l4 4 4-4M4 15v4h16v-4" /></Svg>;

// 64px illustrations for the checklist; `.a` strokes use the accent colour.
const Ill = ({ children }: { children: ReactNode }) => (
  <Svg size={52} width={2} viewBox="0 0 64 64">{children}</Svg>
);
export const IllPhone = () => (
  <Ill><rect x="19" y="6" width="26" height="52" rx="5" /><path d="M29 51h6" /><path d="M27 23l10 10-5 5V18l5 5-10 10" /><path className="a" d="M12 52L52 12" /></Ill>
);
export const IllCharger = () => (
  <Ill><rect x="25" y="4" width="14" height="10" rx="3" /><circle cx="32" cy="27" r="13" /><ellipse cx="32" cy="50" rx="20" ry="6" /><path className="a" d="M34 20l-5 8h6l-4 7" /></Ill>
);
export const IllAwake = () => (
  <Ill><rect x="12" y="14" width="40" height="28" rx="3" /><path d="M6 48h52" /><circle className="a" cx="32" cy="28" r="5" /><path className="a" d="M32 18.5v2M32 35.5v2M22.5 28h2M39.5 28h2" /></Ill>
);
