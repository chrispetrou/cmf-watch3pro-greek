import type { Phase } from "../ble/client";
import type { Language } from "../lib/languages";
import { Bluetooth, BluetoothOff, Check, Cross, Restore } from "./icons";
import type { Screen } from "./screens";

type Props = { screen: Screen; phase: Phase | null; chosen: Language[]; pct: number; watchName: string | null; watchFw: string | null };

type Caption = { s: string; tone: "" | "on" | "ok" | "warn" | "err"; sub: string };

function caption({ screen, phase, chosen, watchName, watchFw }: Props): Caption {
  switch (screen) {
    case "choose":
      return { s: "Live preview", tone: "on", sub: chosen.length ? "Set in Inter, the watch’s own typeface." : "Pick a language to see it here." };
    case "searching": return { s: phase === "connecting" ? "Connecting" : "Searching", tone: "on", sub: "Keep the watch close to this device." };
    case "pairing":
      return phase === "pairing"
        ? { s: "Pairing", tone: "on", sub: "Accept the request if one appears." }
        : { s: "Connecting", tone: "on", sub: phase === "reading" ? "Reading the firmware version." : "Logging in with the saved pairing." };
    case "connected": return { s: "Connected", tone: "ok", sub: watchName ?? "" };
    case "mismatch": return { s: "Connected", tone: "warn", sub: `This watch has firmware ${watchFw}.` };
    case "transfer": return { s: "Receiving", tone: "on", sub: "Leave it on the charger." };
    case "installing": return { s: "Installing", tone: "on", sub: "The screen may go dark for a moment." };
    case "done": return { s: "Ready", tone: "ok", sub: "Pair it with Nothing X again to finish." };
    case "recovery": return { s: "Recovery mode", tone: "warn", sub: "Waiting for the official firmware." };
    case "lost": return { s: "Disconnected", tone: "err", sub: "Bring this device closer to the watch." };
    case "unsupported": return { s: "Not connected", tone: "", sub: "The watch is fine. Only the browser needs to change." };
    default: return { s: "Not connected", tone: "", sub: "Nothing changes on the watch until you install." };
  }
}

function Face({ screen, phase, chosen, pct, watchFw }: Props) {
  if (screen === "pairing" && phase !== "pairing") {
    return <><span className="wacc"><Bluetooth size={26} /></span><span className="q" style={{ margin: "6px 0 0" }}>Connecting…</span></>;
  }
  switch (screen) {
    case "choose":
      return chosen.length === 0 ? (
        <><span className="big">10:42</span><span className="small">Mon 16 Nov</span></>
      ) : (
        <>
          <span className="time">10:42</span>
          {chosen.slice(0, 2).map((m) => (
            <span key={m.id} className="notif" lang={m.code}><b>{m.sender}</b><span>{m.msg}</span></span>
          ))}
        </>
      );
    case "pairing":
      return (
        <>
          <span className="small" style={{ marginTop: 0 }}>Pairing request</span>
          <span className="q">Allow this device to connect?</span>
          <span className="wbtns"><i><Cross size={16} /></i><i className="y"><Check size={16} /></i></span>
        </>
      );
    case "connected":
    case "mismatch":
      return <><span className="wacc"><Bluetooth size={26} /></span><span className="q" style={{ margin: "6px 0 0" }}>Connected</span><span className="small">FW {watchFw}</span></>;
    case "transfer":
      return <><span className="small" style={{ marginTop: 0 }}>Receiving</span><span className="big" style={{ fontSize: 34, marginTop: 4 }}>{pct}%</span><span className="wbar"><i style={{ width: `${pct}%` }} /></span></>;
    case "installing":
      return <><span className="wspin" /><span className="q" style={{ margin: "10px 0 0" }}>Updating…</span></>;
    case "done": {
      const first = chosen[0];
      return <><span className="big">10:42</span><span className="small" lang={first?.code}>{first?.date ?? "Mon 16 Nov"}</span></>;
    }
    case "recovery":
      return <><span className="wacc"><Restore size={26} /></span><span className="q" style={{ margin: "6px 0 0" }}>Recovery</span></>;
    case "lost":
      return <><BluetoothOff size={26} /><span className="q" style={{ margin: "6px 0 0" }}>Disconnected</span><span className="small">{pct}% received</span></>;
    default:
      return <><span className="big">10:42</span><span className="small">Mon 16 Nov</span></>;
  }
}

export function WatchPanel(props: Props) {
  const c = caption(props);
  return (
    <div className="aside-in" aria-label="Your watch">
      <div className="stage">
        <div className="watch" aria-hidden="true">
          <span className="strap t" /><span className="strap b" />
          <span className="crown a" /><span className="crown b" />
          <span className="case"><span className="bezel"><span className="screen"><Face {...props} /></span></span></span>
        </div>
      </div>
      <div className="caption" aria-live="polite">
        <span className={`s ${c.tone}`}><i />{c.s}</span>
        <p>{c.sub}</p>
      </div>
    </div>
  );
}
