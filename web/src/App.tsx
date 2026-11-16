// Watch Languages: the wizard from design/reference/prototype.dc.html.
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { webBluetoothAvailable } from "./ble/client";
import { type FirmwareCheck, type Release, checkFirmware, latestRelease } from "./lib/firmware";
import { LANGUAGES } from "./lib/languages";
import { BluetoothWatch, DemoWatch, type WatchInfo, type WatchLink } from "./lib/watch";
import {
  Arrow, Bluetooth, Check, Code, Copy, Cross, Download, FileUp, IllAwake, IllCharger, IllPhone, Laptop,
  Lock, Moon, Phone, Retry, Sun, Warn, WatchIcon,
} from "./ui/icons";
import { STEP, STEP_LABELS, type Screen } from "./ui/screens";
import { WatchPanel } from "./ui/WatchPanel";

const REPO = "https://github.com/chrispetrou/cmf-watch3pro-languages";
const RING = 2 * Math.PI * 110;

// ?demo drives every screen without Bluetooth; ?demo=mismatch / recovery / unsupported pick a case.
const DEMO = new URLSearchParams(location.search).get("demo");
const DEMO_FW: Record<string, string> = { mismatch: "1.0.1.65", recovery: "0.0.0.1" };

function storedTheme(): "light" | "dark" {
  try {
    const t = localStorage.getItem("wl.theme");
    if (t === "light" || t === "dark") return t;
  } catch { /* no storage */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const cmpVersion = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const NextBtn = (p: { disabled?: boolean; onClick: () => void; children?: ReactNode }) => (
  <button className="btn btn-p" type="button" disabled={p.disabled} onClick={p.onClick}>
    {p.children ?? "Next"} <Arrow />
  </button>
);
const BackBtn = ({ onClick, children = "Back" }: { onClick: () => void; children?: ReactNode }) => (
  <button className="btn btn-g" type="button" onClick={onClick}>{children}</button>
);
const CheckBox = ({ on, onChange }: { on: boolean; onChange: () => void }) => (
  <span className="cbw">
    <input className="cb" type="checkbox" checked={on} onChange={onChange} />
    {on && <span className="cbm"><Check size={18} width={2.25} /></span>}
  </span>
);

export default function App() {
  const supported = DEMO !== null ? DEMO !== "unsupported" : webBluetoothAvailable();
  const [screen, setScreen] = useState<Screen>(supported ? "choose" : "unsupported");
  const [theme, setTheme] = useState(storedTheme);
  const [sel, setSel] = useState<Record<string, boolean>>({ greek: true });
  const [release, setRelease] = useState<Release | null>(null);
  const [fw, setFw] = useState<FirmwareCheck | null>(null);
  const [checkPct, setCheckPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [showAll, setShowAll] = useState(false);
  const [watch, setWatch] = useState<WatchInfo | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const link = useMemo<WatchLink>(
    () => (DEMO !== null ? new DemoWatch(DEMO_FW[DEMO] ?? undefined) : new BluetoothWatch()), [],
  );

  useEffect(() => { latestRelease().then(setRelease); }, []);
  useEffect(() => {
    try { localStorage.setItem("wl.theme", theme); } catch { /* no storage */ }
  }, [theme]);

  const chosen = LANGUAGES.filter((l) => sel[l.id]);
  const dark = theme === "dark";
  const cur = STEP[screen];
  const fwOk = fw?.ok ? fw : null;
  const expected = release?.version ?? "1.0.1.77";
  const total = fwOk ? fwOk.sizeMb : 45.1;
  const names = chosen.map((l) => l.name);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
  const codes = chosen.length ? chosen.map((l) => l.code.toUpperCase()).join(" · ") : "None";
  const ready = checks.filter(Boolean).length;
  const addLog = (m: string) =>
    setLog((l) => [...l, `[${new Date().toLocaleTimeString([], { hour12: false })}] ${m}`]);

  // ------------------------------------------------------------ firmware file
  async function takeFile(file: File | undefined) {
    if (!file) return;
    setScreen("fwChecking");
    setCheckPct(0);
    setFw({ ok: false, file, problem: "" });
    const r = await checkFirmware(file, setCheckPct);
    setFw(r);
    setScreen(r.ok ? "fwValid" : "fwWrong");
  }

  const pickFile = () => fileInput.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    takeFile(e.dataTransfer.files[0]);
  };

  // ------------------------------------------------------------ connect
  async function connect() {
    setConnError(null);
    setLog([]);
    setScreen("searching");
    try {
      const info = await link.connect({
        showAll,
        log: addLog,
        onPhase: (p) => setScreen(p === "pairing" ? "pairing" : "searching"),
      });
      addLog(`watch ${info.name} runs ${info.firmware}`);
      setWatch(info);
      if (info.firmware.startsWith("0.")) setScreen("recovery");
      else setScreen(fwOk && info.firmware === fwOk.version ? "connected" : "mismatch");
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      addLog(`error: ${err.name}: ${err.message}`);
      // Closing the browser's device picker isn't an error worth showing.
      setConnError(err.name === "NotFoundError" ? null : err.message);
      setScreen("prep");
    }
  }

  // ------------------------------------------------------------ install
  async function install(langs: string[]) {
    if (!fwOk) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRestoring(langs.length === 0);
    setPct(0);
    setScreen("transfer");
    try {
      await link.install({ firmware: fwOk.file, langs, signal: ac.signal, onProgress: (p) => setPct(p.pct) });
      setScreen("installing");
      await link.waitForRestart(ac.signal);
      setScreen("done");
    } catch (e) {
      if (ac.signal.aborted) return;
      addLog(`error: ${e instanceof Error ? e.message : String(e)}`);
      setScreen("lost");
    }
  }

  function cancelInstall() {
    abort.current?.abort();
    setScreen("connected");
  }

  function restart() {
    setScreen("choose");
    setWatch(null);
    setChecks([false, false, false]);
    setRestoring(false);
  }

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { /* not allowed */ }
  };

  const mismatchText = () => {
    if (!watch || !fwOk) return "";
    const older = cmpVersion(watch.firmware, fwOk.version) < 0;
    return older
      ? `The update file is made for ${fwOk.version}, but your watch has ${watch.firmware}. Update the watch with Nothing X first, then come back and connect again.`
      : `The update file is made for ${fwOk.version}, but your watch already has ${watch.firmware}. Download the update file for ${watch.firmware}, then come back.`;
  };

  const details = (rows: [string, string][]) => (
    <details className="det">
      <summary>Details</summary>
      <dl className="kv mono">{rows.map(([k, v]) => <FragmentKV key={k} k={k} v={v} />)}</dl>
      {log.length > 0 && <pre className="log mono">{log.join("\n")}</pre>}
    </details>
  );

  const ring = (cls: string, value: number) => (
    <svg className="ring" viewBox="0 0 260 260" aria-hidden="true">
      <circle className="rk" cx="130" cy="130" r="126" />
      <circle className="rt" cx="130" cy="130" r="110" />
      <circle className={cls} cx="130" cy="130" r="110" strokeDasharray={RING.toFixed(1)}
        strokeDashoffset={(RING * (1 - value / 100)).toFixed(1)} transform="rotate(-90 130 130)" />
    </svg>
  );

  return (
    <div className={`wl t-${theme}`}>
      <header className="hdr">
        <div className="brand">
          <span className="logo" aria-hidden="true"><WatchIcon size={22} /></span>
          <span className="bname">Watch Languages</span>
          <span className="badge">Unofficial</span>
          {link.simulated && <span className="badge sim" title="Installing is simulated, nothing is sent to the watch">Preview</span>}
        </div>
        <div className="tools">
          <a className="ghl" href={REPO} aria-label="GitHub"><Code /><span className="ght">GitHub</span></a>
          <button className="ib" type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            onClick={() => setTheme(dark ? "light" : "dark")}>
            {dark ? <Sun /> : <Moon />}
          </button>
        </div>
      </header>

      {cur !== undefined ? (
        <nav className="stepwrap" aria-label="Progress">
          <ol className="stepper">
            {STEP_LABELS.map((label, i) => {
              const done = screen === "done" || i < cur;
              const now = screen !== "done" && i === cur;
              return (
                <li key={label} className={`st ${done ? "st-done" : now ? "st-cur" : "st-todo"}`} aria-current={now ? "step" : undefined}>
                  <span className="stn">{done ? <Check size={16} /> : `0${i + 1}`}</span>
                  <span className="stl">{label}</span>
                </li>
              );
            })}
          </ol>
          <p className="stmob mono">Step {cur + 1} of 4 · {STEP_LABELS[cur]}</p>
        </nav>
      ) : (
        <div className="bandwrap">
          <p className="band mono"><span className="dot" />{screen === "recovery" ? "Recovery mode detected" : "Browser not supported"}</p>
        </div>
      )}

      <main className="stage">
        <section className="main card scr">
          {screen === "choose" && (
            <>
              <p className="eb mono">Step 01 / 04</p>
              <h1 className="h">Choose your languages</h1>
              <p className="lead">Pick the languages you want to read on your watch. You can choose more than one.</p>
              <div className="langs">
                {LANGUAGES.map((l) => {
                  const on = !!sel[l.id];
                  return (
                    <button key={l.id} type="button" className={on ? "lang on" : "lang"} aria-pressed={on}
                      onClick={() => setSel({ ...sel, [l.id]: !on })}>
                      <span>
                        <span className="lname" lang={l.code}>{l.name}</span>
                        <span className="lrow">
                          <span className="lmeta mono">{l.en} · {l.code}</span>
                          {l.tested
                            ? <span className="chip chip-ok"><Check size={12} />Tested</span>
                            : <span className="chip chip-nt">Not tested yet</span>}
                        </span>
                      </span>
                      <span className="tg" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <p className="note">
                “Not tested yet” means it should work, but nobody has tried it on a real watch so far.{" "}
                <a href={`${REPO}/issues`}>Tell us how it went</a>
              </p>
              <div className="acts">
                <span className="mono" style={{ color: "var(--muted)" }}>
                  {chosen.length} {chosen.length === 1 ? "language" : "languages"} selected
                </span>
                <NextBtn disabled={chosen.length === 0} onClick={() => setScreen(fwOk ? "fwValid" : "fwEmpty")} />
              </div>
            </>
          )}

          {cur === 1 && (
            <>
              <p className="eb mono">Step 02 / 04</p>
              <h1 className="h">Get the official firmware</h1>
              <p className="lead">Your watch needs Nothing’s own update file. Download it, then drop it below. We add your languages to it right here, on your device.</p>
              <div className="callout">
                <span className="ci" aria-hidden="true"><Lock /></span>
                <p><b>We can’t download it for you, it stays between you and Nothing.</b><br />
                  <span style={{ color: "var(--muted)" }}>Nothing makes this file. We never see it or store it.</span></p>
              </div>
              <div className="dlrow">
                <a className="btn btn-s" href={release?.url ?? "https://github.com/spike0en/nothing_archive"}>
                  <Download />Download firmware {expected}
                </a>
                <span className="mono" style={{ color: "var(--muted)" }}>about 45 MB · from Nothing</span>
              </div>
              <input ref={fileInput} type="file" accept=".bin" hidden
                onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />

              {screen === "fwEmpty" && (
                <div className={dragOver ? "dz dz-over" : "dz"} onDrop={onDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}>
                  <span className="dzi" aria-hidden="true"><FileUp size={28} /></span>
                  <p className="dzt">Drop the update file here</p>
                  <p className="dzs" style={{ margin: 0 }}>or</p>
                  <button className="btn btn-s" type="button" onClick={pickFile}>Choose file</button>
                  {DEMO !== null && (
                    <button className="btn btn-t" type="button" onClick={() => {
                      setFw({ ok: true, file: new File([], `firmware_${expected}.bin`), version: expected, board: "JX402_08", sizeMb: 45.1 });
                      setScreen("fwValid");
                    }}>Use a demo file</button>
                  )}
                  <p className="mono" style={{ margin: "6px 0 0", color: "var(--muted)" }}>Looking for: firmware {expected} · about 45 MB</p>
                </div>
              )}
              {screen === "fwChecking" && (
                <div className="dz dz-chk">
                  <span className="spin" aria-hidden="true" />
                  <p className="dzt">Checking the file…</p>
                  <p className="mono" style={{ margin: 0, color: "var(--muted)" }}>{fw?.file.name}</p>
                  <div className="bar"><i style={{ width: `${checkPct}%` }} /></div>
                  <p className="mono" style={{ margin: 0, color: "var(--muted)" }}>{checkPct}%</p>
                </div>
              )}
              {screen === "fwValid" && fwOk && (
                <div className="dz dz-ok">
                  <div className="res">
                    <span className="resi resi-ok" aria-hidden="true"><Check size={24} /></span>
                    <div>
                      <p className="dzt">That’s the right file</p>
                      <p className="dzs">The official update for CMF Watch 3 Pro. Ready for your languages.</p>
                      <dl className="kv mono">
                        <dt>File</dt><dd>{fwOk.file.name}</dd>
                        <dt>Version</dt><dd>{fwOk.version}</dd>
                        <dt>Board</dt><dd>{fwOk.board}</dd>
                        <dt>Size</dt><dd>{fwOk.sizeMb.toFixed(1)} MB</dd>
                      </dl>
                      <button className="btn btn-t" type="button" style={{ paddingLeft: 0, marginTop: 6 }}
                        onClick={() => { setFw(null); setScreen("fwEmpty"); }}>Use a different file</button>
                    </div>
                  </div>
                </div>
              )}
              {screen === "fwWrong" && fw && !fw.ok && (
                <div className="dz dz-err">
                  <div className="res">
                    <span className="resi resi-err" aria-hidden="true"><Cross size={24} /></span>
                    <div>
                      <p className="dzt">This isn’t the right file</p>
                      <p className="dzs">We need the {expected} update for CMF Watch 3 Pro. Use the download button above, then drop that file here.</p>
                      <dl className="kv mono"><dt>File</dt><dd>{fw.file.name}</dd><dt>Problem</dt><dd>{fw.problem}</dd></dl>
                      <button className="btn btn-s" type="button" style={{ marginTop: 16 }} onClick={pickFile}>Choose another file</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="acts">
                <BackBtn onClick={() => setScreen("choose")} />
                <NextBtn disabled={screen !== "fwValid"} onClick={() => setScreen("prep")} />
              </div>
            </>
          )}

          {cur === 2 && (
            <>
              <p className="eb mono">Step 03 / 04</p>
              <h1 className="h">Get your watch ready</h1>
              <p className="lead">Three quick things, then we connect.</p>
              {screen === "prep" ? (
                <>
                  <div className="chks">
                    {([
                      [<IllPhone />, "Turn off Bluetooth on your phone", "Otherwise your phone keeps grabbing the watch. You turn it back on at the end."],
                      [<IllCharger />, "Put the watch on its charger", "Leave it there until the end. The install takes about 30 minutes."],
                      [<IllAwake />, "Keep this device awake and nearby", "Plug it in, don’t let the screen lock, and stay within a few steps of the watch."],
                    ] as const).map(([ill, title, sub], i) => (
                      <label key={title} className={checks[i] ? "chk on" : "chk"}>
                        <span className="ill" aria-hidden="true">{ill}</span>
                        <span><span className="ct">{title}</span><span className="cs">{sub}</span></span>
                        <CheckBox on={checks[i]} onChange={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} />
                      </label>
                    ))}
                  </div>
                  {connError && (
                    <div className="status status-warn" style={{ marginTop: 16 }}>
                      <span className="resi resi-warn" aria-hidden="true"><Warn size={22} /></span>
                      <div>
                        <p className="stt">Couldn’t connect</p>
                        <p className="sts">Check the three things above and try again. If the watch isn’t in the list, tick “Show all devices”.</p>
                        {details([["Error", connError]])}
                      </div>
                    </div>
                  )}
                  <div className="acts">
                    <BackBtn onClick={() => setScreen("fwValid")} />
                    <span className="acts-r">
                      <label className="mono" style={{ color: "var(--muted)", display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show all devices
                      </label>
                      <span className="mono" style={{ color: "var(--muted)" }}>{ready} / 3 ready</span>
                      <button className="btn btn-p" type="button" disabled={ready < 3} onClick={connect}>
                        <Bluetooth />Connect watch
                      </button>
                    </span>
                  </div>
                </>
              ) : (
                <div className="ready">
                  <span><Check size={16} />Phone Bluetooth off</span>
                  <span><Check size={16} />On the charger</span>
                  <span><Check size={16} />Device awake</span>
                </div>
              )}
              {screen === "searching" && (
                <>
                  <div className="status">
                    <span className="spin" aria-hidden="true" />
                    <div>
                      <p className="stt">Looking for your watch…</p>
                      <p className="sts">A small window will list nearby devices. Pick <b>CMF Watch 3 Pro</b>, then press Pair.</p>
                      {details([["Mode", DEMO !== null ? "Demo" : "Web Bluetooth"]])}
                    </div>
                  </div>
                  <div className="acts">
                    <BackBtn onClick={() => { link.disconnect(); setScreen("prep"); }} />
                    <button className="btn btn-p" type="button" disabled><span className="spin spin-s" aria-hidden="true" />Searching…</button>
                  </div>
                </>
              )}
              {screen === "pairing" && (
                <>
                  <div className="status status-acc">
                    <span className="resi resi-acc" aria-hidden="true"><WatchIcon size={22} /></span>
                    <div>
                      <p className="stt">Check your watch</p>
                      <p className="sts">If the watch or this device asks to allow the connection, accept it.</p>
                      {details([])}
                    </div>
                  </div>
                  <div className="acts">
                    <BackBtn onClick={() => { link.disconnect(); setScreen("prep"); }} />
                    <button className="btn btn-p" type="button" disabled>Waiting for your watch…</button>
                  </div>
                </>
              )}
              {screen === "connected" && watch && fwOk && (
                <>
                  <div className="status status-ok">
                    <span className="resi resi-ok" aria-hidden="true"><Check size={24} /></span>
                    <div>
                      <p className="stt">Connected</p>
                      <p className="sts">Your watch and the update file match. You’re ready to install.</p>
                      <dl className="kv mono">
                        <dt>Watch</dt><dd>{watch.name}</dd><dt>Firmware</dt><dd>{watch.firmware}</dd><dt>Update file</dt><dd>{fwOk.version}</dd>
                      </dl>
                    </div>
                  </div>
                  <div className="acts">
                    <BackBtn onClick={() => setScreen("prep")} />
                    <NextBtn onClick={() => install(chosen.map((l) => l.id))}>Start install</NextBtn>
                  </div>
                </>
              )}
              {screen === "mismatch" && watch && fwOk && (
                <>
                  <div className="status status-warn">
                    <span className="resi resi-warn" aria-hidden="true"><Warn size={22} /></span>
                    <div>
                      <p className="stt">Your watch is on a different version</p>
                      <p className="sts">{mismatchText()}</p>
                      <dl className="kv mono"><dt>Watch</dt><dd>{watch.firmware}</dd><dt>Update file</dt><dd>{fwOk.version}</dd></dl>
                    </div>
                  </div>
                  <div className="acts">
                    <BackBtn onClick={() => setScreen("prep")} />
                    <button className="btn btn-s" type="button" onClick={connect}><Retry />Connect again</button>
                  </div>
                </>
              )}
            </>
          )}

          {screen === "transfer" && (
            <div className="inst">
              <p className="eb mono">Step 04 / 04</p>
              <h1 className="h">Sending the update to your watch</h1>
              <p className="lead" style={{ marginBottom: 4 }}>This takes about 30 minutes. You can leave it running.</p>
              <div className="ringw">
                {ring("rp", pct)}
                <div className="rc"><span className="pct">{pct}<small>%</small></span><span className="mono rcl">Sent</span></div>
                <progress className="sr" max={100} value={pct}>{pct}%</progress>
              </div>
              <div className="meta mono">
                <span className="pill"><b>{((total * pct) / 100).toFixed(1)}</b> / {total.toFixed(1)} MB</span>
                <span className="pill">~<b>{Math.max(1, Math.round(30 * (1 - pct / 100)))}</b> min left</span>
              </div>
              <p className="warnnote"><Warn />Don’t close this tab</p>
              <button className="btn btn-t" type="button" onClick={cancelInstall}>Cancel</button>
              {details([
                ["Building", restoring ? `${fwOk?.version}, unchanged` : `${fwOk?.version} + ${codes}`],
                ...(link.simulated ? [["Mode", "Simulated, nothing is sent"] as [string, string]] : []),
              ])}
            </div>
          )}

          {screen === "installing" && (
            <div className="inst">
              <p className="eb mono">Step 04 / 04</p>
              <h1 className="h">Installing on the watch…</h1>
              <p className="lead" style={{ marginBottom: 4 }}>Your watch restarts by itself and finishes the job. This takes a few minutes. Leave it on the charger.</p>
              <div className="ringw">
                <svg className="ring" viewBox="0 0 260 260" aria-hidden="true">
                  <circle className="rk" cx="130" cy="130" r="126" />
                  <circle className="rt" cx="130" cy="130" r="110" />
                  <circle className="rp rspin" cx="130" cy="130" r="110" strokeDasharray="170 600" />
                </svg>
                <div className="rc"><WatchIcon size={40} width={1.6} /><span className="mono rcl">On the watch</span></div>
              </div>
              <div className="meta mono"><span className="pill">Transfer complete · <b>{total.toFixed(1)} MB</b></span></div>
              <p className="warnnote"><Warn />Don’t close this tab</p>
            </div>
          )}

          {screen === "done" && (
            <div className="inst">
              <span className="okmark" aria-hidden="true"><Check size={56} width={1.75} /></span>
              <h1 className="h">Your watch is updated</h1>
              <p className="lead" style={{ marginBottom: 0 }}>
                {restoring ? "The official firmware is back on your watch."
                  : `${nameList} ${chosen.length > 1 ? "are" : "is"} now on your watch.`}
              </p>
              <div className="next">
                <p className="eb mono" style={{ margin: 0 }}>One last step</p>
                <p className="stt" style={{ fontSize: 22, marginTop: 6 }}>Now pair the watch with Nothing X again</p>
                <ol className="nlist">
                  <li><span className="nn">1</span>Open the Nothing X app on your phone</li>
                  <li><span className="nn">2</span>Add your watch, just like the first time</li>
                  <li><span className="nn">3</span>Keep the phone close until it’s done</li>
                </ol>
              </div>
              <div className="acts" style={{ width: "100%" }}>
                <a className="btn btn-g" href={`${REPO}#readme`}>Read the guide</a>
                <button className="btn btn-p" type="button" onClick={restart}>Done</button>
              </div>
            </div>
          )}

          {screen === "lost" && (
            <div className="inst">
              <p className="eb mono">Step 04 / 04</p>
              <h1 className="h">Connection lost</h1>
              <p className="lead" style={{ marginBottom: 4 }}>Your watch is fine. Move this device closer, check the watch is still on its charger, then try again.</p>
              <div className="ringw">
                {ring("rp rp-dim", pct)}
                <div className="rc"><span className="pct" style={{ color: "var(--muted)" }}>{pct}<small>%</small></span><span className="mono rcl">Paused</span></div>
              </div>
              <div className="meta mono"><span className="pill">Stopped at <b>{((total * pct) / 100).toFixed(1)}</b> / {total.toFixed(1)} MB</span></div>
              <div className="acts" style={{ width: "100%" }}>
                <BackBtn onClick={() => setScreen("connected")}>Cancel install</BackBtn>
                <button className="btn btn-p" type="button" onClick={() => install(restoring ? [] : chosen.map((l) => l.id))}><Retry />Try again</button>
              </div>
            </div>
          )}

          {screen === "unsupported" && (
            <>
              <p className="eb mono">Can’t connect from this browser</p>
              <h1 className="h">Open this page in Chrome or Edge</h1>
              <p className="lead">This browser can’t talk to your watch over Bluetooth. Any of these will work:</p>
              <div className="opts">
                <div className="opt"><span className="ci" aria-hidden="true"><Laptop /></span><span><span className="ob">On a computer</span><span className="os">Chrome or Edge, on Windows, Mac or ChromeOS</span></span></div>
                <div className="opt"><span className="ci" aria-hidden="true"><Phone /></span><span><span className="ob">On an Android phone</span><span className="os">Chrome</span></span></div>
              </div>
              <p className="nope"><Cross size={18} />Won’t work: iPhone and iPad (any browser), Safari, Firefox</p>
              {details([["Needs", "Web Bluetooth"], ["This browser", "Not available"]])}
              <div className="acts">
                <span className="mono" style={{ color: "var(--muted)" }}>Tip: send the link to your computer</span>
                <button className="btn btn-p" type="button" onClick={copyLink}><Copy />{copied ? "Link copied" : "Copy link to this page"}</button>
              </div>
            </>
          )}

          {screen === "recovery" && (
            <>
              <p className="eb mono">Recovery mode</p>
              <h1 className="h">Let’s get your watch back</h1>
              <p className="lead">Nothing is broken. Your watch is waiting for an update, usually because the last install stopped early. We’ll put the official firmware back on.</p>
              <ol className="rsteps">
                <li className="rstep"><span className="nn">1</span><div><p className="stt">Keep the watch on its charger</p><p className="sts">Leave it there until we’re done.</p></div></li>
                <li className="rstep"><span className="nn">2</span><div><p className="stt">Add the official update file</p><p className="sts">The same file from Nothing as before.</p>
                  {fwOk && <p className="mini mono"><Check size={16} />{fwOk.file.name} · ready</p>}</div></li>
                <li className="rstep"><span className="nn">3</span><div><p className="stt">Restore</p><p className="sts">About 30 minutes. Keep this tab open.</p></div></li>
              </ol>
              {details([["Watch", watch?.name ?? ""], ["Mode", "Recovery"], ["Installs", `Official ${fwOk?.version ?? ""}, unchanged`]])}
              <div className="acts">
                <a className="btn btn-g" href={`${REPO}/issues`}>Get help on GitHub</a>
                <button className="btn btn-p" type="button" disabled={!fwOk} onClick={() => install([])}>Restore official firmware</button>
              </div>
            </>
          )}
        </section>

        <WatchPanel screen={screen} chosen={chosen} pct={pct} watchName={watch?.name ?? null}
          watchFw={watch?.firmware ?? null} fileVersion={fwOk?.version ?? null} />
      </main>

      <footer className="ftr">
        <p>Not affiliated with Nothing or CMF. Use at your own risk. No firmware is hosted here, everything is processed on your device.</p>
        <nav className="flinks" aria-label="Project links">
          <a href={`${REPO}/blob/main/LICENSE`}>License</a>
          <a href={`${REPO}#readme`}>Guide</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </footer>
    </div>
  );
}

const FragmentKV = ({ k, v }: { k: string; v: string }) => (<><dt>{k}</dt><dd>{v}</dd></>);
