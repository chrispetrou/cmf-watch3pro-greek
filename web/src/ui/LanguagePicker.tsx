// Language list that stays usable as languages are added: one compact row each, and from
// SEARCH_FROM languages on, a search field, a scrolling list and chips for what's selected.
import { useMemo, useState } from "react";
import type { Language } from "../lib/languages";
import { Cross, Search } from "./icons";

const SEARCH_FROM = 7;

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Props = { languages: Language[]; selected: Record<string, boolean>; onToggle: (id: string) => void };

export function LanguagePicker({ languages, selected, onToggle }: Props) {
  const [query, setQuery] = useState("");
  const many = languages.length >= SEARCH_FROM;
  const chosen = languages.filter((l) => selected[l.id]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return languages;
    return languages.filter((l) => [l.name, l.en, l.code].some((s) => fold(s).includes(q)));
  }, [languages, query]);

  return (
    <div className="picker">
      {many && (
        <>
          <div className="search">
            <Search size={16} />
            <input type="search" placeholder={`Search ${languages.length} languages`} value={query}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search languages" />
          </div>
          {chosen.length > 0 && (
            <div className="chips" aria-label="Selected languages">
              {chosen.map((l) => (
                <button key={l.id} type="button" className="chip" onClick={() => onToggle(l.id)} aria-label={`Remove ${l.en}`}>
                  <span lang={l.code}>{l.name}</span><Cross size={12} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <div className={many ? "list scroll" : "list"}>
        {shown.map((l) => (
          <label key={l.id} className="row lang-row">
            <span className="native" lang={l.code}>{l.name}</span>
            <span className="en">{l.en}</span>
            <span className={l.tested ? "status-dot ok" : "status-dot"} title={l.tested ? "Tested on a watch" : "Not tested on a watch yet"}>
              <i />{l.tested ? "Tested" : "Not tested yet"}
            </span>
            <input type="checkbox" role="switch" className="switch" checked={!!selected[l.id]}
              onChange={() => onToggle(l.id)} aria-label={l.en} />
          </label>
        ))}
        {shown.length === 0 && (
          <p className="empty">
            No language matches “{query}”. <a href="https://github.com/chrispetrou/cmf-watch3pro-languages/issues/new?template=language-request.yml">Request it</a>
          </p>
        )}
      </div>
    </div>
  );
}
