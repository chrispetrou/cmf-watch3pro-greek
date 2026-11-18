import type { CSSProperties } from "react";
import { ArrowDownToLine, Bluetooth, BluetoothOff, Check, X } from "lucide-react";
import type { Phase } from "@/ble/client";
import type { Language } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { type Strings, useT } from "@/i18n";
import type { Screen } from "./screens";

type Props = { screen: Screen; phase: Phase | null; chosen: Language[]; pct: number; watchName: string | null; watchFw: string | null };

type Caption = { s: string; tone: "" | "on" | "ok" | "warn" | "err" };

const DOT: Record<Caption["tone"], string> = { "": "bg-faint", on: "bg-brand", ok: "bg-ok", warn: "bg-warn", err: "bg-err" };

function caption({ screen, phase }: Props, p: Strings["panel"]): Caption {
  switch (screen) {
    case "choose":
      return { s: p.livePreview, tone: "on" };
    case "searching": return { s: phase === "connecting" ? p.connecting : p.searching, tone: "on" };
    case "pairing":
      return { s: phase === "pairing" ? p.pairing : p.connecting, tone: "on" };
    case "connected": return { s: p.connected, tone: "ok" };
    case "mismatch": return { s: p.connected, tone: "warn" };
    case "transfer": return { s: p.receiving, tone: "on" };
    case "installing": return { s: p.installing, tone: "on" };
    case "done": return { s: p.ready, tone: "ok" };
    case "recovery": return { s: p.recovery, tone: "warn" };
    case "lost": return { s: p.disconnected, tone: "err" };
    case "unsupported": return { s: p.notConnected, tone: "" };
    default: return { s: p.notConnected, tone: "" };
  }
}

function Face({ screen, phase, chosen, pct, watchFw }: Props) {
  // Looking for the watch or talking to it: the Bluetooth mark sends out rings.
  if (screen === "searching" || (screen === "pairing" && phase !== "pairing")) {
    return (
      <>
        <span className="wacc wping"><Bluetooth className="size-6.5" /></span>
        <span className="q" style={{ margin: "14px 0 0" }}>{screen === "searching" && phase === null ? "Searching…" : "Connecting…"}</span>
      </>
    );
  }
  switch (screen) {
    case "choose":
      return chosen.length === 0 ? (
        <><span className="big">10:42</span><span className="small">Mon 16 Nov</span></>
      ) : (
        <>
          {/* Up to two full cards; from three on, compact one-line cards and a count of the rest. */}
          {chosen.length < 3 && <span className="time">10:42</span>}
          {chosen.slice(0, 3).map((m) => (
            <span key={m.id} className={chosen.length < 3 ? "notif" : "notif compact"} lang={m.code}><b>{m.sender}</b><span>{m.msg}</span></span>
          ))}
          {chosen.length > 3 && <span className="small more">+{chosen.length - 3} more</span>}
        </>
      );
    case "pairing":
      return (
        <>
          <span className="small" style={{ marginTop: 0 }}>Pairing request</span>
          <span className="q">Allow this device to connect?</span>
          <span className="wbtns"><i><X className="size-4" /></i><i className="y"><Check className="size-4" /></i></span>
        </>
      );
    case "connected":
    case "mismatch":
      return <><span className="wacc"><Bluetooth className="size-6.5" /></span><span className="q" style={{ margin: "6px 0 0" }}>Connected</span><span className="small">FW {watchFw}</span></>;
    case "transfer":
      return <><span className="small" style={{ marginTop: 0 }}>Receiving</span><span className="big" style={{ fontSize: 34, marginTop: 4 }}>{pct}%</span></>;
    case "installing":
      return <><span className="wspin" /><span className="q" style={{ margin: "10px 0 0" }}>Updating…</span></>;
    case "done": {
      const first = chosen[0];
      return <><span className="big">10:42</span><span className="small" lang={first?.code}>{first?.date ?? "Mon 16 Nov"}</span></>;
    }
    case "recovery":
      return <><span className="wacc"><ArrowDownToLine className="size-6.5" /></span><span className="q" style={{ margin: "6px 0 0" }}>Recovery</span></>;
    case "lost":
      return <><BluetoothOff className="size-6.5" /><span className="q" style={{ margin: "6px 0 0" }}>Disconnected</span><span className="small">{pct}% received</span></>;
    default:
      return <><span className="big">10:42</span><span className="small">Mon 16 Nov</span></>;
  }
}

export function WatchPanel(props: Props) {
  const { t } = useT();
  const c = caption(props, t.panel);
  return (
    <div className="sticky top-14 flex flex-col items-center px-6 py-8 max-lg:static max-lg:px-4 max-lg:pt-2 max-lg:pb-5" aria-label="Your watch">
      <div className="stage">
        <div className="watch" aria-hidden="true">
          <span className="strap t" /><span className="strap b" />
          <span className="crown a" /><span className="crown b" />
          <span className="case"><span className="bezel">
            {/* During the transfer the bezel fills up like a progress ring. */}
            {props.screen === "transfer" && <span className="pring" style={{ "--p": props.pct } as CSSProperties} />}
            <span className="screen"><Face {...props} /></span></span></span>
        </div>
      </div>
      {props.screen !== "choose" && <div className="mt-4.5 max-w-[30ch] text-center max-lg:mt-1.5" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium"><i className={cn("size-1.5 rounded-full", DOT[c.tone])} />{c.s}</span>
      </div>}
    </div>
  );
}
