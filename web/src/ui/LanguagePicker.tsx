// Language list that stays usable as languages are added: one compact row each, and from
// SEARCH_FROM languages on, a search field, a scrolling list and chips for what's selected.
import { useId, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import type { Language } from "@/lib/languages";
import { cn } from "@/lib/utils";

const SEARCH_FROM = 7;
const REQUEST = "https://github.com/chrispetrou/cmf-watch3pro-languages/issues/new?template=language-request.yml";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Props = { languages: Language[]; selected: Record<string, boolean>; onToggle: (id: string) => void };

export function LanguagePicker({ languages, selected, onToggle }: Props) {
  const { lang, t } = useT();
  const [query, setQuery] = useState("");
  const id = useId();
  const many = languages.length >= SEARCH_FROM;
  const label = (l: Language) => (lang === "el" ? l.el ?? l.en : l.en);
  const chosen = languages.filter((l) => selected[l.id]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return languages;
    return languages.filter((l) => [l.name, l.en, l.el ?? "", l.code].some((s) => fold(s).includes(q)));
  }, [languages, query]);

  return (
    <div>
      {many && (
        <>
          <div className="relative mb-2.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input type="search" className="h-10 pl-9" placeholder={t.search(languages.length)}
              value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t.searchLabel} />
          </div>
          {chosen.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5" aria-label={t.selected}>
              {chosen.map((l) => (
                <Badge key={l.id} asChild variant="outline" className="h-7 cursor-pointer gap-1.5 rounded-full bg-muted pr-2 pl-2.5 text-sm">
                  <button type="button" onClick={() => onToggle(l.id)} aria-label={t.remove(l.en)}>
                    <span>{label(l)}</span><X className="text-muted-foreground" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
      <div className={cn("divide-y overflow-hidden rounded-xl border", many && "max-h-84 overflow-y-auto overscroll-contain")}>
        {shown.map((l) => (
          <label key={l.id} htmlFor={`${id}-${l.id}`}
            className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted max-sm:px-3.5 max-sm:py-3">
            {/* Only the exceptions are marked; tested is the norm. */}
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-base font-semibold tracking-tight">{label(l)}</span>
              {!l.tested && <Badge variant="outline" className="rounded-full font-medium text-muted-foreground">{t.notTested}</Badge>}
            </span>
            <Switch id={`${id}-${l.id}`} checked={!!selected[l.id]} onCheckedChange={() => onToggle(l.id)} aria-label={l.en} />
          </label>
        ))}
        {shown.length === 0 && (
          <p className="px-4 py-4.5 text-sm text-muted-foreground">
            {t.noMatch(query)} <a className="hit text-foreground underline underline-offset-3" href={REQUEST}>{t.requestIt}</a>
          </p>
        )}
      </div>
    </div>
  );
}

/** The "More emoji" option under the languages: a row like theirs with its own switch. */
export function EmojiOption({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useT();
  const id = useId();
  return (
    <label htmlFor={id} className="mt-2.5 flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors hover:bg-muted max-sm:px-3.5 max-sm:py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold tracking-tight">{t.emojiTitle}</span>
        <span className="block text-sm text-muted-foreground">{t.emojiText}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={t.emojiTitle} />
    </label>
  );
}
