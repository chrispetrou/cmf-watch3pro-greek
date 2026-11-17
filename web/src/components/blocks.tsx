// Small building blocks shared by the wizard's steps, on top of shadcn/ui.
import type { ReactNode } from "react";
import { ChevronRight, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "ok" | "warn" | "err";

const TILE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border border-border",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  err: "bg-err-soft text-err",
};

/** A tinted square around an icon: the only place a status gets colour. */
export function IconTile({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4", TILE[tone])}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("size-4 animate-spin", className)} aria-hidden="true" />;
}

/** Status card: a neutral Alert with the icon in a tinted tile. */
export function Notice({ tone = "neutral", icon, title, children, className }: {
  tone?: Tone; icon: ReactNode; title: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <Alert role={tone === "err" || tone === "warn" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-xl bg-background p-3.5", className)}>
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1 pt-1.5">
        <AlertTitle className="line-clamp-none text-sm font-medium">{title}</AlertTitle>
        {children && <AlertDescription className="mt-0.5 block text-sm">{children}</AlertDescription>}
      </div>
    </Alert>
  );
}

/** "Technical details": key/value rows and the log, folded away. */
export function Details({ rows = [], log }: { rows?: [string, string][]; log: string[] }) {
  const { t } = useT();
  return (
    <Collapsible className="mt-3 text-[13px]">
      <CollapsibleTrigger className="hit group flex items-center gap-1 rounded text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {t.details}
      </CollapsibleTrigger>
      {/* Height follows Radix's measured content height, so it opens and closes smoothly. */}
      <CollapsibleContent className="overflow-hidden duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        {rows.length > 0 && (
          <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {log.length > 0 && (
          <pre className="mt-2 max-h-52 overflow-auto rounded-lg border bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
            {log.join("\n")}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A file or result row: icon tile, a truncating name, small meta items, an optional action. */
export function FileRow({ tone = "neutral", icon, name, mono, meta, action, children, className }: {
  tone?: Tone; icon: ReactNode; name: ReactNode; mono?: boolean; meta?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border bg-background px-3.5 py-3", tone === "err" && "border-err/40", className)}>
      <IconTile tone={tone}>{icon}</IconTile>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate", mono ? "font-mono text-[13px]" : "text-sm font-medium")} title={typeof name === "string" ? name : undefined}>{name}</div>
        {meta && <div className="mt-0.5 flex flex-wrap gap-x-3.5 text-[13px] text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">{meta}</div>}
        {children}
      </div>
      {action}
    </div>
  );
}

/** The row under each step: buttons on the left (main action first), then a muted note; stacks on phones. */
export function Actions({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1 max-sm:[&>a]:flex-1">
      {children}
      {note && <div className="ml-2 min-w-0 flex-1 text-[13px] text-muted-foreground max-sm:ml-0 max-sm:basis-full">{note}</div>}
    </div>
  );
}
