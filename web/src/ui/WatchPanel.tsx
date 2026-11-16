import type { Language } from "../lib/languages";
import { Bluetooth, BluetoothOff, Check, Cross, Restore } from "./icons";
import type { Screen } from "./screens";

type Props = {
  screen: Screen;
  chosen: Language[];
  pct: number;
  watchName: string | null;
  watchFw: string | null;
  fileVersion: string | null;
};

const IDLE = { t: "Your watch", st: "Not connected", led: "", sub: "We connect in step 3. Nothing changes on the watch yet." };

function panel(p: Props) {
  const codes = p.chosen.length ? p.chosen.map((l) => l.code.toUpperCase()).join(" · ") : "None";
  switch (p.screen) {
    case "choose": return { t: "Live preview", st: codes, led: "led-on", sub: "This is how messages will look on your watch." };
    case "prep": return { ...IDLE, sub: "Keep it on the charger, close to this device." };
    case "searching": return { ...IDLE, st: "Searching", led: "led-on", sub: "Keep the watch close to this device." };
    case "pairing": return { ...IDLE, st: "Pairing", led: "led-on", sub: "Your watch is asking for permission." };
    case "connected": return { ...IDLE, st: "Connected", led: "led-ok", sub: p.watchName ?? "" };
    case "mismatch": return { ...IDLE, st: "Connected", led: "led-warn", sub: `This watch has firmware ${p.watchFw}.` };
    case "transfer": return { ...IDLE, st: "Receiving", led: "led-on", sub: "Leave it on the charger." };
    case "installing": return { ...IDLE, st: "Installing", led: "led-on", sub: "The screen may go dark for a moment. That’s normal." };
    case "done": return { ...IDLE, st: "Ready", led: "led-ok", sub: "Pair it with Nothing X again to finish." };
    case "unsupported": return { ...IDLE, sub: "Your watch is fine. Only the browser needs to change." };
    case "recovery": return { ...IDLE, st: "Recovery", led: "led-warn", sub: "It’s waiting for the official firmware." };
    case "lost": return { ...IDLE, st: "Disconnected", led: "led-err", sub: "Bring this device closer to the watch." };
    default: return IDLE;
  }
}

function Screen({ screen, chosen, pct, watchFw }: Props) {
  const compact = chosen.length > 2;
  switch (screen) {
    case "choose":
      return (
        <>
          <span className="wt">10:42</span>
          {chosen.length > 0 && chosen.length < 3 && <span className="wlab"><i />Messages</span>}
          {chosen.map((m) => (
            <span key={m.id} className={compact ? "wn wn-c" : "wn"} lang={m.code}>
              <span className="wns">{m.sender}</span>
              <span className={compact ? "wnm wnm-1" : "wnm"}>{m.msg}</span>
            </span>
          ))}
          {chosen.length === 0 && <span className="wsm wsm-n">Pick a language to see it here</span>}
        </>
      );
    case "pairing":
      return (
        <>
          <span className="wsm" style={{ marginTop: 0 }}>Pairing request</span>
          <span className="wq">Allow this device to connect?</span>
          <span className="wbtns"><span className="wbtn"><Cross size={18} /></span><span className="wbtn wbtn-y"><Check size={18} /></span></span>
        </>
      );
    case "connected":
    case "mismatch":
      return (
        <>
          <span className="wacc"><Bluetooth size={28} /></span>
          <span className="wq" style={{ margin: "6px 0 0" }}>Connected</span>
          <span className="wsm">FW {watchFw}</span>
        </>
      );
    case "transfer":
      return (
        <>
          <span className="wsm" style={{ marginTop: 0 }}>Receiving</span>
          <span className="wbig" style={{ fontSize: 38, marginTop: 6 }}>{pct}%</span>
          <span className="wbar"><i style={{ width: `${pct}%` }} /></span>
        </>
      );
    case "installing":
      return (
        <>
          <span className="wspin" />
          <span className="wq" style={{ margin: "12px 0 0" }}>Updating…</span>
          <span className="wsm">Keep on charger</span>
        </>
      );
    case "done": {
      const first = chosen[0];
      return (
        <>
          <span className="wbig">10:42</span>
          {first ? <span className="wsm wsm-n" lang={first.code}>{first.date}</span> : <span className="wsm">Mon 16 Nov</span>}
        </>
      );
    }
    case "recovery":
      return (
        <>
          <span className="wacc"><Restore size={28} /></span>
          <span className="wq" style={{ margin: "6px 0 0" }}>Recovery</span>
          <span className="wsm">Waiting for update</span>
        </>
      );
    case "lost":
      return (
        <>
          <BluetoothOff size={28} />
          <span className="wq" style={{ margin: "6px 0 0" }}>Disconnected</span>
          <span className="wsm">{pct}% received</span>
        </>
      );
    default:
      return (
        <>
          <span className="wbig">10:42</span>
          <span className="wsm">Mon 16 Nov</span>
          {screen === "searching" && (
            <span className="wsm wacc" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Bluetooth size={12} />Visible
            </span>
          )}
        </>
      );
  }
}

export function WatchPanel(props: Props) {
  const d = panel(props);
  return (
    <aside className="side card scr dev" aria-label="Your watch">
      <div className="devh mono"><span>{d.t}</span><span className={`led ${d.led}`}><i />{d.st}</span></div>
      <div className="watch" aria-hidden="true">
        {props.screen === "searching" && <><span className="rings" /><span className="rings rings2" /></>}
        <span className="strap strap-t" /><span className="strap strap-b" />
        <span className="crown" /><span className="crown crown2" />
        <span className="case"><span className="bez"><span className="wscr"><Screen {...props} /></span></span></span>
      </div>
      <p className="devs">{d.sub}</p>
    </aside>
  );
}
