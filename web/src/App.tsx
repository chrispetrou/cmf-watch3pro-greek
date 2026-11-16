// Watch Languages: choose languages, add the official firmware, connect, install.
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { webBluetoothAvailable } from "./ble/client";
import { type FirmwareCheck, type Release, checkFirmware, latestRelease } from "./lib/firmware";
import { LANGUAGES } from "./lib/languages";
import { BluetoothWatch, DemoWatch, type WatchInfo, type WatchLink } from "./lib/watch";
import { Bluetooth, Check, Code, Copy, Cross, Download, FileUp, Moon, Retry, Sun, Warn } from "./ui/icons";
import { STEP, type Screen } from "./ui/screens";
import { WatchPanel } from "./ui/WatchPanel";

const REPO = "https://github.com/chrispetrou/cmf-watch3pro-languages";

// ?demo drives every screen without Bluetooth; ?demo=mismatch / recovery / unsupported pick a case.
const DEMO = new URLSearchParams(location.search).get("demo");
const DEMO_FW: Record<string, string> = { mismatch: "1.0.1.65", recovery: "0.0.0.1" };

type Theme = "light" | "dark" | null;

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem("wl.theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

const cmpVersion = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const listNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";

function Note({ tone = "", icon, title, children }: { tone?: string; icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`note ${tone}`} role={tone === "err" || tone === "warn" ? "alert" : undefined}>
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}><p className="t">{title}</p>{children && <div className="s">{children}</div>}</div>
    </div>
  );
}

export default function App() {
  const supported = DEMO !== null ? DEMO !== "unsupported" : webBluetoothAvailable();
  const [screen, setScreen] = useState<Screen>(supported ? "choose" : "unsupported");
  const [theme, setTheme] = useState<Theme>(storedTheme);
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
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem("wl.theme", theme);
      else localStorage.removeItem("wl.theme");
    } catch { /* no storage */ }
  }, [theme]);

  const dark = theme ? theme === "dark" : systemDark();
  const chosen = LANGUAGES.filter((l) => sel[l.id]);
  const cur = STEP[screen];
  const busy = screen === "transfer" || screen === "installing";
  const fwOk = fw?.ok ? fw : null;
  const expected = release?.version ?? "1.0.1.77";
  const total = fwOk ? fwOk.sizeMb : 45.1;
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
      // Closing the browser's device picker isn't worth an error message.
      setConnError(err.name === "NotFoundError" ? null : err.message);
      setScreen("prep");
    }
  }

  function cancelConnect() {
    link.disconnect();
    setScreen("prep");
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

  function startOver() {
    setScreen("choose");
    setWatch(null);
    setChecks([false, false, false]);
    setRestoring(false);
  }

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); } catch { /* not allowed */ }
  };

  const more = (rows: [string, string][]) => (
    <details className="more">
      <summary>Technical details</summary>
      {rows.length > 0 && <dl className="kv mono">{rows.map(([k, v]) => <KV key={k} k={k} v={v} />)}</dl>}
      {log.length > 0 && <pre className="log mono">{log.join("\n")}</pre>}
    </details>
  );

  // ------------------------------------------------------------ step bodies
  const chooseBody = (
    <>
      <p className="lede">Pick the languages you want to read on your watch. You can choose more than one.</p>
      <div className="list">
        {LANGUAGES.map((l) => (
          <label key={l.id} className="row">
            <span className="row-main">
              <span className="row-title native" lang={l.code}>{l.name}</span>
              <span className="row-sub" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                {l.en}
                <span className={l.tested ? "status-dot ok" : "status-dot"}><i />{l.tested ? "Tested on a watch" : "Not tested yet"}</span>
              </span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={!!sel[l.id]}
              onChange={() => setSel({ ...sel, [l.id]: !sel[l.id] })} aria-label={l.en} />
          </label>
        ))}
      </div>
      <div className="actions">
        <span className="grow">
          Not tested yet means it should work, but nobody has confirmed it on a real watch.{" "}
          <a href={`${REPO}/issues`}>Tell us how it went</a>
        </span>
        <button className="btn btn-primary" type="button" disabled={chosen.length === 0}
          onClick={() => setScreen(fwOk ? "fwValid" : "fwEmpty")}>Continue</button>
      </div>
    </>
  );

  const fwBody = (
    <>
      <p className="lede">
        Your languages are added to Nothing’s official update, right here in the browser. Download it from
        Nothing, then add it below. It isn’t uploaded anywhere.
      </p>
      <div className="dl">
        <a className="btn btn-secondary" href={release?.url ?? "https://github.com/spike0en/nothing_archive"}>
          <Download size={16} />Download firmware {expected}
        </a>
        <span className="muted" style={{ fontSize: 13 }}>About 45 MB, from Nothing’s servers</span>
      </div>
      <input ref={fileInput} type="file" accept=".bin" hidden
        onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />

      {screen === "fwEmpty" && (
        <div className={dragOver ? "drop over" : "drop"} onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}>
          <FileUp size={22} />
          <p>Drop the update file here, or <button className="link" type="button" onClick={pickFile}>choose a file</button></p>
          <p className="hint">The .bin file you just downloaded</p>
          {DEMO !== null && (
            <p className="hint"><button className="link" type="button" onClick={() => {
              setFw({ ok: true, file: new File([], `CMF_JX402_08_ATS3089C_V${expected}_GPS_V6.bin`), version: expected, board: "JX402_08", sizeMb: 45.1 });
              setScreen("fwValid");
            }}>Use a demo file</button></p>
          )}
        </div>
      )}
      {screen === "fwChecking" && fw && (
        <div className="file">
          <span className="file-icon"><span className="spinner" /></span>
          <span className="file-main">
            <span className="file-name mono" title={fw.file.name}>{fw.file.name}</span>
            <span className="bar"><i style={{ width: `${checkPct}%` }} /></span>
          </span>
          <span className="muted" style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>Checking {checkPct}%</span>
        </div>
      )}
      {screen === "fwValid" && fwOk && (
        <div className="file ok">
          <span className="file-icon"><Check size={16} /></span>
          <span className="file-main">
            <span className="file-name mono" title={fwOk.file.name}>{fwOk.file.name}</span>
            <span className="file-meta"><span>Version <b>{fwOk.version}</b></span><span>{fwOk.sizeMb.toFixed(1)} MB</span><span>Official, unmodified</span></span>
          </span>
          <button className="btn btn-ghost" type="button" onClick={() => { setFw(null); setScreen("fwEmpty"); }}>Replace</button>
        </div>
      )}
      {screen === "fwWrong" && fw && !fw.ok && (
        <>
          <div className="file bad">
            <span className="file-icon"><Cross size={16} /></span>
            <span className="file-main">
              <span className="file-name mono" title={fw.file.name}>{fw.file.name}</span>
              <span className="file-meta" style={{ color: "var(--err)" }}>{fw.problem}</span>
            </span>
            <button className="btn btn-secondary" type="button" onClick={pickFile}>Choose another</button>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
            Use the download button above to get the {expected} update for the CMF Watch 3 Pro.
          </p>
        </>
      )}
      <div className="actions">
        <span className="grow" />
        <button className="btn btn-primary" type="button" disabled={screen !== "fwValid"} onClick={() => setScreen("prep")}>Continue</button>
      </div>
    </>
  );

  const PREP = [
    ["Turn off Bluetooth on your phone", "Otherwise the phone keeps the watch to itself. You turn it back on at the end."],
    ["Put the watch on its charger", "Leave it there until the end. Installing takes about 30 minutes."],
    ["Keep this device awake and close", "Plug it in, stop the screen from locking, and stay within a few steps of the watch."],
  ] as const;

  const connectBody = (
    <>
      {screen === "prep" && (
        <>
          <div className="list">
            {PREP.map(([t, s], i) => (
              <label key={t} className="row">
                <input type="checkbox" className="check" checked={checks[i]}
                  onChange={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} />
                <span className="row-main"><span className="row-title">{t}</span><span className="row-sub">{s}</span></span>
              </label>
            ))}
          </div>
          {connError && (
            <div style={{ marginTop: 12 }}>
              <Note tone="err" icon={<Warn size={16} />} title="Couldn’t connect to the watch">
                Check the three things above and try again. If the watch isn’t in the list, show all devices.
                {more([["Error", connError]])}
              </Note>
            </div>
          )}
          <div className="actions">
            <label className="grow" style={{ display: "inline-flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" className="check" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all Bluetooth devices
            </label>
            <button className="btn btn-primary" type="button" disabled={ready < 3} onClick={connect}>
              <Bluetooth size={16} />Connect watch
            </button>
          </div>
        </>
      )}
      {(screen === "searching" || screen === "pairing") && (
        <>
          <Note icon={<span className="spinner" />} title={screen === "searching" ? "Looking for your watch" : "Waiting for your watch"}>
            {screen === "searching"
              ? <>Pick <b>CMF Watch 3 Pro</b> in the browser’s list, then press Pair.</>
              : "If the watch or this device asks to allow the connection, accept it."}
            {more([["Mode", DEMO !== null ? "Demo" : "Web Bluetooth"]])}
          </Note>
          <div className="actions"><span className="grow" /><button className="btn btn-secondary" type="button" onClick={cancelConnect}>Cancel</button></div>
        </>
      )}
      {screen === "connected" && watch && fwOk && (
        <>
          <Note tone="ok" icon={<Check size={16} />} title="Connected, and the versions match">
            <dl className="kv"><dt>Watch</dt><dd>{watch.name}</dd><dt>Watch firmware</dt><dd>{watch.firmware}</dd><dt>Update file</dt><dd>{fwOk.version}</dd></dl>
          </Note>
          <div className="actions">
            <span className="grow">Installing takes about 30 minutes.</span>
            <button className="btn btn-primary" type="button" onClick={() => install(chosen.map((l) => l.id))}>Start install</button>
          </div>
        </>
      )}
      {screen === "mismatch" && watch && fwOk && (
        <>
          <Note tone="warn" icon={<Warn size={16} />} title="The watch is on a different version">
            {cmpVersion(watch.firmware, fwOk.version) < 0
              ? `The update file is for ${fwOk.version}, but the watch has ${watch.firmware}. Update the watch with Nothing X first, then connect again.`
              : `The update file is for ${fwOk.version}, but the watch already has ${watch.firmware}. Download the update file for ${watch.firmware} instead.`}
          </Note>
          <div className="actions"><span className="grow" /><button className="btn btn-secondary" type="button" onClick={connect}><Retry size={16} />Connect again</button></div>
        </>
      )}
    </>
  );

  const installBody = (
    <>
      {screen === "transfer" && (
        <>
          <div className="progress-head">
            <span className="pct">{pct}%</span>
            <span className="progress-meta">
              <span>{((total * pct) / 100).toFixed(1)} of {total.toFixed(1)} MB</span>
              <span>About {Math.max(1, Math.round(30 * (1 - pct / 100)))} min left</span>
            </span>
          </div>
          <div className="bar big" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
          <Note icon={<Warn size={16} />} title="Keep this tab open">The watch pulls the update from this page. Closing it stops the transfer.</Note>
          <div className="actions">
            <span className="grow">{restoring ? "Restoring the official firmware" : `Adding ${listNames(chosen.map((l) => l.en))}`}</span>
            <button className="btn btn-secondary" type="button" onClick={cancelInstall}>Cancel</button>
          </div>
          {link.simulated && more([["Mode", "Simulated, nothing is sent to the watch"]])}
        </>
      )}
      {screen === "installing" && (
        <>
          <p className="lede" style={{ marginBottom: 10 }}>The transfer is done. The watch is installing the update and will restart by itself. Leave it on the charger.</p>
          <div className="bar big indet"><i /></div>
        </>
      )}
      {screen === "done" && (
        <>
          <Note tone="ok" icon={<Check size={16} />} title={restoring ? "The official firmware is back on your watch" : `${listNames(chosen.map((l) => l.en))} ${chosen.length > 1 ? "are" : "is"} on your watch`} />
          <p style={{ margin: "20px 0 0", fontWeight: 500 }}>One more thing: pair the watch with your phone again</p>
          <ol className="ol">
            <li>Turn Bluetooth back on and open Nothing X.</li>
            <li>Add the watch, like the first time.</li>
            <li>Keep the phone close until it’s done.</li>
          </ol>
          <div className="actions">
            <span className="grow" />
            <a className="btn btn-ghost" href={`${REPO}#readme`}>Read the guide</a>
            <button className="btn btn-primary" type="button" onClick={startOver}>Start over</button>
          </div>
        </>
      )}
      {screen === "lost" && (
        <>
          <Note tone="err" icon={<Warn size={16} />} title={`The connection dropped at ${pct}%`}>
            The watch is fine. Move this device closer, check the watch is still on its charger, then try again.
            {more([])}
          </Note>
          <div className="actions">
            <span className="grow" />
            <button className="btn btn-ghost" type="button" onClick={() => setScreen("connected")}>Cancel install</button>
            <button className="btn btn-primary" type="button" onClick={() => install(restoring ? [] : chosen.map((l) => l.id))}><Retry size={16} />Try again</button>
          </div>
        </>
      )}
    </>
  );

  const steps: { title: string; summary?: ReactNode; edit?: Screen; body: ReactNode }[] = [
    { title: "Choose languages", summary: listNames(chosen.map((l) => l.en)), edit: "choose", body: chooseBody },
    { title: "Add the official firmware", summary: fwOk && `Firmware ${fwOk.version}`, edit: "fwValid", body: fwBody },
    { title: "Connect the watch", summary: watch && `${watch.name}, ${watch.firmware}`, edit: "prep", body: connectBody },
    { title: "Install", body: installBody },
  ];

  // ------------------------------------------------------------ special cases
  const special =
    screen === "unsupported" ? (
      <>
        <h2 className="step-title" style={{ fontSize: 18 }}>Open this page in Chrome or Edge</h2>
        <p className="lede" style={{ marginTop: 8 }}>
          Talking to the watch needs Web Bluetooth, which this browser doesn’t have. It works in Chrome or Edge
          on Windows, macOS, ChromeOS and Linux, and in Chrome on Android. It doesn’t work on iPhone or iPad, in
          Safari or in Firefox.
        </p>
        <div className="actions">
          <span className="grow">Tip: send the link to your computer.</span>
          <button className="btn btn-primary" type="button" onClick={copyLink}><Copy size={16} />{copied ? "Link copied" : "Copy link"}</button>
        </div>
      </>
    ) : screen === "recovery" ? (
      <>
        <h2 className="step-title" style={{ fontSize: 18 }}>Your watch is waiting for an update</h2>
        <p className="lede" style={{ marginTop: 8 }}>
          Nothing is broken. This usually means the last install stopped early. Putting the official firmware
          back fixes it.
        </p>
        <ol className="ol" style={{ color: "var(--fg)" }}>
          <li>Keep the watch on its charger.</li>
          <li>Use the official update file{fwOk && <> (<span className="mono">{fwOk.version}</span> is ready)</>}.</li>
          <li>Restore. It takes about 30 minutes, keep this tab open.</li>
        </ol>
        {more([["Watch", watch?.name ?? ""], ["Reported version", watch?.firmware ?? ""]])}
        <div className="actions">
          <span className="grow" />
          <a className="btn btn-ghost" href={`${REPO}/issues`}>Get help on GitHub</a>
          <button className="btn btn-primary" type="button" disabled={!fwOk} onClick={() => install([])}>Restore official firmware</button>
        </div>
      </>
    ) : null;

  return (
    <>
      <header className="hdr">
        <div className="hdr-in">
          <a className="brand" href="./"><span className="brand-mark"><i /></span>Watch Languages<span className="tag">Unofficial</span></a>
          <div className="tools">
            <a className="icon-btn" href={REPO}><Code size={16} /><span className="label">GitHub</span></a>
            <button className="icon-btn" type="button" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>
      {link.simulated && (
        <div className="banner"><b>Preview.</b> Connecting is real, installing is only simulated. Nothing is written to the watch yet.</div>
      )}

      <div className="frame">
        <section className="hero">
          <h1>Read your language on the CMF Watch 3 Pro</h1>
          <p>Adds Greek or Georgian letters to the watch’s own font, in your browser. Free, open source, and not affiliated with Nothing.</p>
        </section>

        <div className="rule" />
        <main className="split">
          <section className="flow">
            {special ?? (
              <ol className="steps">
                {steps.map((s, i) => {
                  const state = cur === undefined ? "todo" : screen === "done" || i < cur ? "done" : i === cur ? "cur" : "todo";
                  return (
                    <li key={s.title} className={`step ${state}`} aria-current={state === "cur" ? "step" : undefined}>
                      <span className="num">{state === "done" ? <Check size={12} width={2.5} /> : i + 1}</span>
                      <div className="step-head">
                        <h2 className="step-title">{s.title}</h2>
                        {state === "done" && s.summary && (
                          <span className="step-sum">
                            <span>{s.summary}</span>
                            {s.edit && !busy && screen !== "done" && (
                              <button className="link" type="button" onClick={() => setScreen(s.edit!)}>Edit</button>
                            )}
                          </span>
                        )}
                      </div>
                      {state === "cur" && <div className="step-body" key={screen.slice(0, 2)}>{s.body}</div>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <aside className="aside">
            <WatchPanel screen={screen} chosen={chosen} pct={pct} watchName={watch?.name ?? null} watchFw={watch?.firmware ?? null} />
          </aside>
        </main>
        <div className="rule" />

        <footer className="ftr">
          <p>Not affiliated with Nothing or CMF. Use at your own risk. No firmware is hosted here, everything is processed on your device.</p>
          <nav aria-label="Project links">
            <a href={`${REPO}#readme`}>Guide</a>
            <a href={`${REPO}/blob/main/LICENSE`}>License</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </footer>
      </div>
    </>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (<><dt>{k}</dt><dd>{v}</dd></>);
