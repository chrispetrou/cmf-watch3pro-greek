// Watch Languages: choose languages, add the official firmware, connect, install.
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Bluetooth, Check, Code, Copy, Download, FileUp, Info, Moon, RotateCw, Sun, TriangleAlert, Watch as WatchIcon, X,
} from "lucide-react";
import { Actions, Details, FileRow, Notice, Spinner } from "@/components/blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Phase, webBluetoothAvailable } from "@/ble/client";
import { type BuildResult, buildImage } from "@/build";
import { I18n, STRINGS, UI_LANGS, type UiLang, storedUiLang } from "@/i18n";
import { type FirmwareCheck, type Release, checkFirmware, latestRelease } from "@/lib/firmware";
import { EMOJI_PREVIEW, LANGUAGES, type Language, demoLanguages } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { BluetoothWatch, DemoWatch, type WatchInfo, type WatchLink } from "@/lib/watch";
import { EmojiOption, LanguagePicker } from "@/ui/LanguagePicker";
import { STEP, type Screen } from "@/ui/screens";
import { WatchPanel } from "@/ui/WatchPanel";
import { GlyphField } from "@/ui/GlyphField";

type FirmwareOk = Extract<FirmwareCheck, { ok: true }>;
// The demo file is empty, so there is nothing to build.
type Built = { key: string; result: BuildResult | null };
const buildKey = (f: File, langs: string[]) => `${f.name}:${f.size}:${f.lastModified}|${langs.join(",")}`;

const REPO = "https://github.com/chrispetrou/cmf-watch3pro-languages";

// ?demo drives every screen without Bluetooth; ?demo=mismatch / recovery / unsupported / noverify / many pick a case.
const DEMO = new URLSearchParams(location.search).get("demo");
const DEMO_FW: Record<string, string> = { mismatch: "1.0.1.65", recovery: "0.0.0.1" };
const LANGS = DEMO === "many" ? demoLanguages() : LANGUAGES;

type Theme = "light" | "dark" | null;

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem("wl.theme");
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

// iPhone and iPad (iPadOS reports itself as a Mac with a touch screen).
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Chromium has view transitions, and Web Bluetooth only runs there anyway; elsewhere screens just swap.
const canTransition = "startViewTransition" in document;

const SHORT_TITLE = "Watch Languages";

/** Focus the current step's heading, and scroll it into view when it isn't comfortably visible. */
function revealStep() {
  const h = document.querySelector<HTMLElement>('[aria-current="step"] h2');
  if (!h) return;
  h.focus({ preventScroll: true });
  const top = h.getBoundingClientRect().top;
  if (top < 72 || top > innerHeight * 0.6) h.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

const cmpVersion = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const etaMinutes = (startedAt: number, pct: number) =>
  pct < 3 ? null : Math.round(((Date.now() - startedAt) / pct) * (100 - pct) / 60000);

const Lede = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("mb-4.5 max-w-[60ch] text-muted-foreground", className)}>{children}</p>
);

const Indeterminate = () => (
  <div className="my-2.5 h-1.5 overflow-hidden rounded-full bg-border">
    <div className="h-full w-[30%] animate-indeterminate rounded-full bg-brand" />
  </div>
);

export default function App() {
  const supported = DEMO !== null ? DEMO !== "unsupported" : webBluetoothAvailable();
  const [uiLang, setUiLang] = useState<UiLang>(storedUiLang);
  const t = STRINGS[uiLang];
  const [screen, setScreenNow] = useState<Screen>(supported ? "choose" : "unsupported");
  const screenRef = useRef(screen);
  const transition = useRef<ViewTransition | null>(null);
  // Every screen change goes through a view transition: the steps glide to their new heights and
  // the watch face crossfades, instead of the page jumping.
  function setScreen(s: Screen) {
    if (s === screenRef.current || !canTransition || reducedMotion() || document.hidden) {
      screenRef.current = s;
      setScreenNow(s);
      return;
    }
    screenRef.current = s;
    const vt = document.startViewTransition(() => flushSync(() => setScreenNow(s)));
    transition.current = vt;
    // A newer screen change skips this one; that's expected, not an error.
    vt.ready.catch(() => {});
    vt.finished.finally(() => { if (transition.current === vt) transition.current = null; });
  }
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [sysDark, setSysDark] = useState(systemDark);
  const [sel, setSel] = useState<Record<string, boolean>>({ greek: true });
  // "Remove the languages": install Nothing's file unchanged, the same path as a recovery restore.
  const [restoreOnly, setRestoreOnly] = useState(false);
  const [emoji, setEmoji] = useState(true);
  const [release, setRelease] = useState<Release | null>(null);
  const [fw, setFw] = useState<FirmwareCheck | null>(null);
  const [checkPct, setCheckPct] = useState(0);
  // A file dragged over the page during the firmware step: the whole page becomes the drop target.
  const [pageDrag, setPageDrag] = useState(false);
  const [checks, setChecks] = useState([false, false, false]);
  const [showAll, setShowAll] = useState(false);
  const [watch, setWatch] = useState<WatchInfo | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [sent, setSent] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [confirmStop, setConfirmStop] = useState(false);
  const [restartLeft, setRestartLeft] = useState<number | null>(null);
  const [newFw, setNewFw] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [stopped, setStopped] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  // True from "Start install" until the result is known, whatever screen is showing.
  const [installing, setInstalling] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [built, setBuilt] = useState<Built | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const link = useMemo<WatchLink>(
    () => (DEMO !== null ? new DemoWatch(DEMO_FW[DEMO] ?? undefined) : new BluetoothWatch()), [],
  );

  useEffect(() => { latestRelease().then(setRelease); }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const dark = theme ? theme === "dark" : sysDark;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      if (theme) localStorage.setItem("wl.theme", theme);
      else localStorage.removeItem("wl.theme");
    } catch { /* no storage */ }
  }, [theme, dark]);
  useEffect(() => {
    document.documentElement.lang = uiLang;
    try { localStorage.setItem("wl.lang", uiLang); } catch { /* no storage */ }
  }, [uiLang]);

  const chosen = LANGS.filter((l) => sel[l.id]);
  const langName = (l: Language) => (uiLang === "el" ? l.el ?? l.en : l.en);
  // What gets added: the languages, plus "emoji" for the emoji option (also in the build key,
  // the install and the download name).
  const parts = [...chosen.map((l) => l.id), ...(emoji ? ["emoji"] : [])];
  const chosenNames = t.list([...chosen.map(langName), ...(emoji ? [t.emojiItem] : [])]);
  const manyParts = parts.length > 1 || emoji;
  const cur = STEP[screen];
  const busy = installing || screen === "transfer" || screen === "installing";
  const fwOk = fw?.ok ? fw : null;
  const expected = release?.version ?? "1.0.1.77";
  const ready = checks.filter(Boolean).length;
  const langIds = restoreOnly ? [] : parts;
  const buildFresh = !!fwOk && !!built && built.key === buildKey(fwOk.file, langIds) && !buildError;
  const addLog = (m: string) =>
    setLog((l) => [...l, `[${new Date().toLocaleTimeString([], { hour12: false })}] ${m}`]);

  // A new step: move focus to it and bring it into view (on phones the watch sits above the steps),
  // once any view transition has finished so the scroll doesn't fight the animation.
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const vt = transition.current;
    if (vt) vt.finished.then(revealStep); else revealStep();
  }, [cur]);

  // The install takes up to half an hour, so show how far it is in the tab title too.
  const baseTitle = useRef(document.title);
  useEffect(() => {
    document.title = screen === "transfer" ? `${pct}% · ${SHORT_TITLE}`
      : screen === "installing" ? `${t.panel.installing}… · ${SHORT_TITLE}`
      : screen === "done" ? `✓ ${t.panel.ready} · ${SHORT_TITLE}`
      : baseTitle.current;
  }, [screen, pct, t]);

  // ------------------------------------------------------------ firmware file
  async function takeFile(file: File | undefined) {
    if (!file) return;
    setScreen("fwChecking");
    setCheckPct(0);
    setFw({ ok: false, file, problem: "" });
    const r = await checkFirmware(file, setCheckPct);
    setFw(r);
    if (r.ok) await startBuild(r);
    else setScreen("fwWrong");
  }

  // ------------------------------------------------------------ build
  async function startBuild(check: FirmwareOk, langs = langIds) {
    const key = buildKey(check.file, langs);
    if (built?.key === key && !buildError) { setScreen("fwValid"); return; }
    setScreen("fwBuilding");
    setBuildError(null);
    setBuilt(null);
    setLog([]);
    try {
      // Nothing to build for the demo file or when installing the official firmware unchanged.
      const result = check.file.size === 0 || langs.length === 0 ? null
        : await buildImage(check.file, langs.filter((l) => l !== "emoji"), langs.includes("emoji"), addLog);
      if (result && !result.versionOk) throw new Error("VERSION_CHECK");
      if (result) addLog(`built ${(result.image.size / 1e6).toFixed(1)} MB, sha256 ${result.sha256}`);
      setBuilt({ key, result });
      setImageUrl((old) => { if (old) URL.revokeObjectURL(old); return result ? URL.createObjectURL(result.image) : null; });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`error: ${msg}`);
      setBuildError(msg.includes("TOO_BIG") ? "TOO_BIG" : msg === "VERSION_CHECK" ? "VERSION_CHECK"
        : msg.trim().split("\n").at(-1) ?? msg); // a Python traceback ends with the actual error
    }
    setScreen("fwValid");
  }

  const pickFile = () => fileInput.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setPageDrag(false);
    takeFile(e.dataTransfer.files[0]);
  };
  const acceptsDrop = screen === "fwEmpty" || screen === "fwWrong" || screen === "fwValid";
  useEffect(() => {
    const hasFile = (e: globalThis.DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: globalThis.DragEvent) => { if (acceptsDrop && hasFile(e)) setPageDrag(true); };
    // A file dropped outside the overlay (or on another step) would make the browser open it and lose the page.
    const block = (e: globalThis.DragEvent) => { if (hasFile(e)) e.preventDefault(); };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [acceptsDrop]);

  // ------------------------------------------------------------ connect
  async function connect() {
    setConnError(null);
    setStopped(false);
    setPhase(null);
    setLog([]);
    setScreen("searching");
    try {
      const info = await link.connect({
        showAll,
        log: addLog,
        onPhase: (p) => { setPhase(p); setScreen(p === "connecting" ? "searching" : "pairing"); },
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
    setSent(0);
    setStartedAt(Date.now());
    setConfirmStop(false);
    setProblem(null);
    setStopped(false);
    setInstalling(true);
    setScreen("transfer");
    // Keep the screen on and warn before the tab is closed while the watch depends on it.
    let lock: WakeLockSentinel | null = null;
    try { lock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed, the checklist covers it */ }
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    let stage = "transfer", lastPct = 0;
    try {
      // The demo file is empty and never built, the demo only pretends to send it.
      const image = langs.length === 0 ? fwOk.file : built?.result?.image ?? (link.simulated ? fwOk.file : undefined);
      if (!image) throw new Error("the patched image isn’t built yet");
      await link.install({ image, langs, signal: ac.signal, onProgress: (p) => { lastPct = p.pct; setPct(p.pct); setSent(p.sent); } });
      stage = "install";
      setScreen("installing");
      setNewFw(null);
      setVerifyError(null);
      setRestartLeft(null);
      // The watch confirmed the whole transfer, so the install counts as done. Reading the version
      // afterwards is a check: if the page can't reconnect by itself, the done screen offers a button.
      const v = await link.waitForRestart(ac.signal, setRestartLeft);
      setNewFw(v);
      setScreen(v?.startsWith("0.") ? "recovery" : "done");
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      addLog(`error: ${msg}`);
      setProblem(stage === "transfer"
        ? { title: t.transferStoppedAt(lastPct), body: t.transferStoppedText }
        : { title: t.afterTransferTitle, body: t.afterTransferText });
      setScreen("lost");
    } finally {
      setInstalling(false);
      window.removeEventListener("beforeunload", guard);
      lock?.release().catch(() => {});
    }
  }

  async function verify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      const v = await link.verify({ showAll, log: addLog });
      setNewFw(v);
      if (v.startsWith("0.")) setScreen("recovery");
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      addLog(`error: ${err.name}: ${err.message}`);
      if (err.name !== "NotFoundError") setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  function stopInstall() {
    abort.current?.abort();
    setConfirmStop(false);
    setStopped(true);
    setWatch(null);
    setScreen("prep");
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

  const details = (rows: [string, string][] = []) => <Details rows={rows} log={log} />;

  // ------------------------------------------------------------ step bodies
  const chooseBody = (
    <>
      <Lede>{t.chooseLede}</Lede>
      <LanguagePicker languages={LANGS} selected={sel} onToggle={(id) => { setRestoreOnly(false); setSel({ ...sel, [id]: !sel[id] }); }} />
      <EmojiOption checked={emoji} onChange={(v) => { setRestoreOnly(false); setEmoji(v); }} />
      <p className="mt-3 flex gap-2 text-[13px] text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />{t.noKorean}</p>
      <Actions note={LANGS.some((l) => !l.tested) && <>{t.notTestedNote}{" "}<a className="hit text-foreground underline underline-offset-3" href={`${REPO}/issues`}>{t.tellUs}</a></>}>
        <Button disabled={parts.length === 0} onClick={() => { setRestoreOnly(false); if (fwOk) startBuild(fwOk, parts); else setScreen("fwEmpty"); }}>{t.continue}</Button>
      </Actions>
      <button type="button" className="hit mt-4 text-[13px] text-muted-foreground underline decoration-input underline-offset-3 hover:text-foreground hover:decoration-current"
        onClick={() => { setRestoreOnly(true); if (fwOk) startBuild(fwOk, []); else setScreen("fwEmpty"); }}>{t.removeAll}</button>
    </>
  );

  const fwBody = (
    <>
      <Lede>{restoreOnly ? t.fwLedeRestore : t.fwLede}</Lede>
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <Button variant="outline" asChild>
          <a href={release?.url ?? "https://github.com/spike0en/nothing_archive"}><Download />{t.download(expected)}</a>
        </Button>
        <span className="text-[13px] text-muted-foreground">{t.downloadNote}</span>
      </div>
      <input ref={fileInput} type="file" accept=".bin" hidden
        onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ""; }} />

      {screen === "fwEmpty" && (
        <div className="rounded-xl border border-dashed border-input bg-muted px-5 py-7 text-center">
          <FileUp className="mx-auto size-5.5 text-faint" />
          <p className="mt-2">
            {t.drop}{" "}
            <button type="button" className="hit font-medium underline decoration-input underline-offset-3 hover:decoration-current" onClick={pickFile}>{t.chooseFile}</button>
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{t.dropHint}</p>
          {DEMO !== null && (
            <button type="button" className="hit mt-1 text-[13px] underline underline-offset-3" onClick={() => {
              const demo: FirmwareOk = { ok: true, file: new File([], `CMF_JX402_08_ATS3089C_V${expected}_GPS_V6.bin`), version: expected, board: "JX402_08", sizeMb: 45.1 };
              setFw(demo);
              startBuild(demo);
            }}>{t.demoFile}</button>
          )}
        </div>
      )}
      {screen === "fwChecking" && fw && (
        <FileRow icon={<Spinner />} name={fw.file.name} mono
          action={<span className="text-[13px] text-muted-foreground tabular-nums">{t.checking(checkPct)}</span>}>
          <Progress value={checkPct} className="mt-2 h-1 [&>[data-slot=progress-indicator]]:bg-brand" />
        </FileRow>
      )}
      {screen === "fwValid" && fwOk && (
        <FileRow tone="ok" icon={<Check />} name={fwOk.file.name} mono
          meta={<><span>{t.version} <b>{fwOk.version}</b></span><span>{fwOk.sizeMb.toFixed(1)} MB</span><span>{t.official}</span></>}
          action={<Button variant="ghost" size="sm" onClick={() => { setFw(null); setBuilt(null); setScreen("fwEmpty"); }}>{t.replace}</Button>} />
      )}
      {screen === "fwBuilding" && (
        <FileRow className="mt-3" icon={<Spinner />} name={t.adding(chosenNames)} meta={t.buildNote}>
          <Indeterminate />
        </FileRow>
      )}
      {screen === "fwValid" && buildError && (
        <div className="mt-3">
          <Notice tone="err" icon={<TriangleAlert />} title={t.buildFailed}>
            {buildError === "TOO_BIG" ? t.tooBig : buildError === "VERSION_CHECK" ? t.versionCheckFailed : buildError}
            {details()}
          </Notice>
          <Actions>
            <Button variant="outline" onClick={() => fwOk && startBuild(fwOk)}><RotateCw />{t.tryAgain}</Button>
          </Actions>
        </div>
      )}
      {screen === "fwValid" && buildFresh && built?.result && (
        <>
          <FileRow className="mt-3" tone="ok" icon={<Check />} name={t.added(chosenNames)}
            meta={<><span>{(built.result.image.size / 1e6).toFixed(1)} MB</span><span>{t.fontOk}</span><span>{t.notSentYet}</span></>}
            action={imageUrl && fwOk && (
              <Button variant="ghost" size="sm" asChild>
                <a href={imageUrl} download={`CMF_Watch3Pro_${fwOk.version}_${[...langIds].sort().join("-")}.bin`} title={t.downloadPatchedTitle}>{t.downloadPatched}</a>
              </Button>
            )} />
          {details([["Image", `${(built.result.image.size / 1e6).toFixed(1)} MB`], ["SHA-256", built.result.sha256], ["Font version", "29, matches the app"]])}
        </>
      )}
      {screen === "fwValid" && buildFresh && built && !built.result && (restoreOnly ? (
        <FileRow className="mt-3" tone="ok" icon={<Check />} name={t.officialUnchanged} meta={t.officialUnchangedMeta} />
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">{t.demoNoBuild}</p>
      ))}
      {screen === "fwWrong" && fw && !fw.ok && (
        <>
          <FileRow tone="err" icon={<X />} name={fw.file.name} mono
            meta={<span className="text-err">{t.problems[fw.problem] ?? fw.problem}</span>}
            action={<Button variant="outline" size="sm" onClick={pickFile}>{t.chooseAnother}</Button>} />
          <p className="mt-2.5 text-[13px] text-muted-foreground">{t.wrongHint(expected)}</p>
        </>
      )}
      <Actions>
        <Button disabled={screen !== "fwValid" || !buildFresh} onClick={() => setScreen("prep")}>{t.continue}</Button>
      </Actions>
    </>
  );

  const connectBody = (
    <>
      {screen === "prep" && (
        <>
          <div className="divide-y overflow-hidden rounded-xl border">
            {t.prep.map(([title, sub], i) => (
              <label key={i} htmlFor={`prep-${i}`} className="flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted">
                <Checkbox id={`prep-${i}`} className="mt-0.5" checked={checks[i]}
                  onCheckedChange={() => setChecks(checks.map((c, j) => (j === i ? !c : c)))} />
                <span className="min-w-0">
                  <span className="block font-medium">{title}</span>
                  <span className="mt-0.5 block text-[13.5px] text-muted-foreground">{sub}</span>
                </span>
              </label>
            ))}
          </div>
          {stopped && !connError && (
            <Notice className="mt-3" icon={<TriangleAlert />} title={t.stoppedTitle}>{t.stoppedText}</Notice>
          )}
          {connError && (
            <Notice className="mt-3" tone="err" icon={<TriangleAlert />} title={t.connFailed}>
              {t.connFailedText}
              {details([["Error", connError]])}
            </Notice>
          )}
          <Actions note={
            <label htmlFor="show-all" className="inline-flex cursor-pointer items-center gap-2">
              <Checkbox id="show-all" checked={showAll} onCheckedChange={(v) => setShowAll(v === true)} />
              {t.showAll}
            </label>
          }>
            <Button disabled={ready < 3} onClick={connect}><Bluetooth />{t.connect}</Button>
          </Actions>
        </>
      )}
      {(screen === "searching" || screen === "pairing") && (
        <>
          <Notice icon={<Spinner />} title={t.phase[phase ?? "picker"][0]}>
            {phase === null ? <>{t.pickInList[0]}<b className="text-foreground">{t.pickInList[1]}</b>{t.pickInList[2]}</> : t.phase[phase][1]}
            {details([["Mode", DEMO !== null ? "Demo" : "Web Bluetooth"]])}
          </Notice>
          <Actions><Button variant="outline" onClick={cancelConnect}>{t.cancel}</Button></Actions>
        </>
      )}
      {screen === "connected" && watch && fwOk && (
        <>
          <Notice tone="ok" icon={<Check />} title={t.connected}>
            <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[13px]">
              <dt>{t.watch}</dt><dd className="truncate text-foreground">{watch.name}</dd>
              <dt>{t.watchFw}</dt><dd className="text-foreground">{watch.firmware}</dd>
              <dt>{t.updateFile}</dt><dd className="text-foreground">{fwOk.version}</dd>
            </dl>
          </Notice>
          <Actions note={t.upTo30}>
            <Button onClick={() => install(langIds)}>{t.startInstall}</Button>
          </Actions>
        </>
      )}
      {screen === "mismatch" && watch && fwOk && (
        <>
          <Notice tone="warn" icon={<TriangleAlert />} title={t.mismatchTitle}>
            {cmpVersion(watch.firmware, fwOk.version) < 0 ? t.mismatchOlder(fwOk.version, watch.firmware) : t.mismatchNewer(fwOk.version, watch.firmware)}
          </Notice>
          <Actions><Button variant="outline" onClick={connect}><RotateCw />{t.connectAgain}</Button></Actions>
        </>
      )}
    </>
  );

  const installBody = (
    <>
      {screen === "transfer" && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{pct}%</span>
            <span className="flex gap-4 text-[13px] text-muted-foreground tabular-nums max-sm:flex-col max-sm:items-end max-sm:gap-0">
              <span>{t.sentMb((sent / 1e6).toFixed(1))}</span>
              <span>{t.eta(etaMinutes(startedAt, pct))}</span>
            </span>
          </div>
          <Progress value={pct} aria-label={`${pct}%`} className="mt-2.5 mb-4 h-1.5 [&>[data-slot=progress-indicator]]:bg-brand" />
          <Notice icon={<TriangleAlert />} title={t.keepOpen}>{t.keepOpenText}</Notice>
          {confirmStop ? (
            <div className="mt-3">
              <Notice tone="warn" icon={<TriangleAlert />} title={t.stopTitle}>{t.stopText}</Notice>
              <Actions>
                <Button variant="outline" onClick={stopInstall}>{t.stopTransfer}</Button>
                <Button variant="ghost" onClick={() => setConfirmStop(false)}>{t.keepGoing}</Button>
              </Actions>
            </div>
          ) : (
            <Actions note={restoring ? t.restoringOfficial : t.adding(chosenNames)}>
              <Button variant="outline" onClick={() => setConfirmStop(true)}>{t.stop}</Button>
            </Actions>
          )}
          {details(link.simulated ? [["Mode", "Demo, nothing is sent to the watch"]] : [])}
        </>
      )}
      {screen === "installing" && (
        <>
          <Lede className="mb-2.5">{t.installingText}</Lede>
          <Indeterminate />
          <p className="text-[13px] text-muted-foreground tabular-nums">{restartLeft ? t.checkingIn(restartLeft) : restartLeft === 0 ? t.checkingNow : ""}</p>
          {details()}
        </>
      )}
      {screen === "done" && (
        <>
          <Notice tone="ok" icon={<Check />} title={restoring ? t.doneOfficial : t.doneLangs(chosenNames, manyParts)}>
            {newFw ? t.doneVerified(newFw) : t.doneUnverified}
          </Notice>
          {!newFw && (
            <div className="mt-3">
              <Notice icon={<WatchIcon />} title={t.checkScreen}>
                {t.checkScreenText}
                {verifyError && <p className="mt-1.5 text-err">{t.verifyFailed(verifyError)}</p>}
                {details()}
              </Notice>
              <Actions>
                <Button variant="outline" disabled={verifying} onClick={verify}>
                  {verifying ? <><Spinner />{t.checkingWatch}</> : <><Bluetooth />{t.checkWatch}</>}
                </Button>
              </Actions>
            </div>
          )}
          <p className="mt-5 font-medium">{t.pairAgain}</p>
          <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-muted-foreground marker:text-faint">
            {t.pairSteps.map((s) => <li key={s} className="pl-1">{s}</li>)}
          </ol>
          <Actions>
            <Button onClick={startOver}>{t.startOver}</Button>
            <Button variant="ghost" asChild><a href={`${REPO}#readme`}>{t.readGuide}</a></Button>
          </Actions>
        </>
      )}
      {screen === "lost" && (
        <>
          <Notice tone="err" icon={<TriangleAlert />} title={problem?.title ?? t.somethingWrong}>
            {problem?.body}
            {details()}
          </Notice>
          <Actions>
            <Button onClick={() => install(restoring ? [] : parts)}><RotateCw />{t.tryAgain}</Button>
            <Button variant="ghost" onClick={() => { setWatch(null); setScreen("prep"); }}>{t.connectAgain}</Button>
          </Actions>
        </>
      )}
    </>
  );

  const steps: { summary?: ReactNode; edit?: Screen; body: ReactNode }[] = [
    { summary: restoreOnly ? t.noneOfficial : chosenNames.charAt(0).toUpperCase() + chosenNames.slice(1), edit: "choose", body: chooseBody },
    { summary: fwOk && t.fwSummary(fwOk.version), edit: "fwValid", body: fwBody },
    { summary: watch && `${watch.name}, ${watch.firmware}`, edit: "prep", body: connectBody },
    { body: installBody },
  ];

  // ------------------------------------------------------------ special cases
  const special =
    screen === "unsupported" ? (
      <>
        <h2 className="text-lg font-semibold tracking-tight">{isIOS ? t.iosTitle : t.unsupportedTitle}</h2>
        <Lede className="mt-2">{isIOS ? t.iosText : t.unsupportedText}</Lede>
        <Actions note={t.sendLink}>
          <Button onClick={copyLink}><Copy />{copied ? t.linkCopied : t.copyLink}</Button>
        </Actions>
      </>
    ) : screen === "recovery" ? (
      <>
        <h2 className="text-lg font-semibold tracking-tight">{t.recoveryTitle}</h2>
        <Lede className="mt-2">{t.recoveryText}</Lede>
        <ol className="list-decimal space-y-1 pl-5 marker:text-faint">
          {t.recoverySteps(fwOk?.version ?? null).map((s) => <li key={s} className="pl-1">{s}</li>)}
        </ol>
        {details([[t.watch, watch?.name ?? ""], [t.reportedVersion, watch?.firmware ?? ""]])}
        <Actions>
          <Button disabled={!fwOk} onClick={() => install([])}>{t.restore}</Button>
          <Button variant="ghost" asChild><a href={`${REPO}/issues`}>{t.getHelp}</a></Button>
        </Actions>
      </>
    ) : null;

  return (
    <I18n.Provider value={{ lang: uiLang, t }}>
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center justify-between gap-3 px-6 max-sm:px-4">
          <a className="flex items-center gap-2.5 font-semibold tracking-tight whitespace-nowrap" href="./">
            <span className="grid size-6 place-items-center rounded-full bg-foreground"><i className="size-3 rounded-full border-[1.5px] border-background" /></span>
            Watch Languages
            <Badge variant="outline" className="rounded-full font-medium text-muted-foreground max-sm:hidden">{t.unofficial}</Badge>
          </a>
          <div className="flex items-center gap-1">
            <ToggleGroup type="single" size="sm" variant="outline" value={uiLang} aria-label={t.pageLanguage}
              onValueChange={(v) => v && setUiLang(v as UiLang)}>
              {UI_LANGS.map((l) => (
                <ToggleGroupItem key={l.id} value={l.id} aria-label={l.name} className="px-2.5 text-xs font-semibold">{l.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground max-[379px]:hidden">
              <a href={REPO} aria-label="GitHub"><Code /><span className="max-sm:hidden">GitHub</span></a>
            </Button>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={dark ? t.themeToLight : t.themeToDark}
              onClick={() => setTheme(dark ? "light" : "dark")}>
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>
      {pageDrag && acceptsDrop && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm animate-in fade-in-0 duration-150"
          onDragOver={(e) => e.preventDefault()} onDragLeave={() => setPageDrag(false)} onDrop={onDrop}>
          <div className="pointer-events-none flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-dashed border-brand bg-background px-6 py-12 text-center">
            <FileUp className="size-7 text-brand" />
            <p className="mt-3 font-medium">{t.dropAnywhere}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{t.dropHint}</p>
          </div>
        </div>
      )}
      {link.simulated && (
        <div className="border-b bg-muted px-6 py-2 text-center text-[13px] text-muted-foreground">
          <b className="font-medium text-foreground">{t.demo}</b> {t.demoBanner}
        </div>
      )}

      <div className="mx-auto max-w-[1120px] border-x max-sm:border-x-0">
        <section className="grid grid-cols-[minmax(0,1fr)_400px] max-lg:grid-cols-1">
          <div className="px-6 pt-14 pb-10 max-sm:px-4 max-sm:pt-8 max-sm:pb-6">
            {/* Audiowide only has Latin letters, so the Greek title stays in Inter rather than mixing fonts. */}
            <h1 className={cn("max-w-[20ch] leading-[1.15]", uiLang === "en"
              ? "font-display text-[clamp(26px,3.6vw,36px)] font-normal tracking-[-0.01em]"
              : "text-[clamp(28px,4vw,40px)] font-semibold tracking-[-0.035em]")}>{t.heroTitle}</h1>
            <p className="mt-3.5 max-w-[54ch] text-[17px] text-muted-foreground max-sm:text-[15.5px]">{t.heroText(t.heroLangs)}</p>
          </div>
          {/* Above the watch column: the same boxes turning into letters as at the bottom. */}
          <div className="relative max-lg:hidden"><GlyphField variant="patch" /></div>
        </section>

        <div className="rule" />
        <main className="grid grid-cols-[minmax(0,1fr)_400px] max-lg:grid-cols-1">
          <section className="min-w-0 border-r px-6 pt-8 pb-12 max-lg:border-r-0 max-sm:px-4">
            {special ?? (
              <ol>
                {steps.map((s, i) => {
                  const state = cur === undefined ? "todo" : screen === "done" || i < cur ? "done" : i === cur ? "cur" : "todo";
                  const last = i === steps.length - 1;
                  return (
                    <li key={i} className="relative pb-7 pl-10 [view-transition-class:step] max-sm:pl-9" aria-current={state === "cur" ? "step" : undefined}
                      style={{ viewTransitionName: `step-${i}` }}>
                      {!last && <span className={cn("absolute top-[30px] bottom-1.5 left-[11px] w-px", state === "done" ? "bg-input" : "bg-border")} />}
                      <span className={cn("absolute top-0.5 left-0 grid size-[23px] place-items-center rounded-full border text-xs font-semibold tabular-nums",
                        state === "done" && "border-foreground bg-foreground text-background",
                        state === "cur" && "border-brand bg-background text-brand ring-4 ring-brand/15",
                        state === "todo" && "border-input bg-background text-faint")}>
                        {state === "done" ? <Check className="size-3" strokeWidth={3} /> : i + 1}
                      </span>
                      <div className="flex min-h-[27px] items-baseline gap-3 max-sm:flex-wrap">
                        <h2 tabIndex={-1} className={cn("scroll-mt-20 text-base font-semibold tracking-tight outline-none", state === "todo" && "font-medium text-faint")}>{t.steps[i]}</h2>
                        {state === "done" && s.summary && (
                          <span className="ml-auto flex min-w-0 items-baseline gap-3 text-sm text-muted-foreground max-sm:ml-0 max-sm:basis-full">
                            <span className="truncate">{s.summary}</span>
                            {s.edit && !busy && screen !== "done" && (
                              <button type="button" className="hit font-medium text-foreground underline decoration-input underline-offset-3 hover:decoration-current"
                                onClick={() => setScreen(s.edit!)}>{t.edit}</button>
                            )}
                          </span>
                        )}
                      </div>
                      {(state === "cur" || (screen === "done" && last)) && (
                        <div key={screen.slice(0, 2)} className={cn("mt-3.5", !canTransition && "animate-in fade-in-0 slide-in-from-top-1 duration-200")}>{s.body}</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <aside className="max-lg:order-first max-lg:border-b">
            <WatchPanel screen={screen} phase={phase} chosen={emoji ? [...chosen, EMOJI_PREVIEW] : chosen} pct={pct} watchName={watch?.name ?? null} watchFw={watch?.firmware ?? null} />
          </aside>
        </main>
        <div className="rule" />

        <footer className="[view-transition-name:footer] flex flex-wrap justify-between gap-x-6 gap-y-4 px-6 pt-6 pb-10 text-[13px] text-muted-foreground max-sm:px-4">
          <p className="max-w-[60ch]">{t.footer}</p>
          <nav className="flex gap-4.5" aria-label="Project links">
            <a className="hit hover:text-foreground" href={`${REPO}#readme`}>{t.guide}</a>
            <a className="hit hover:text-foreground" href={`${REPO}/blob/main/LICENSE`}>{t.license}</a>
            <a className="hit hover:text-foreground" href={REPO}>GitHub</a>
          </nav>
        </footer>
        <GlyphField />
      </div>
    </I18n.Provider>
  );
}
