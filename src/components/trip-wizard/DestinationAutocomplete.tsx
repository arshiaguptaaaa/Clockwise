"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Plus } from "lucide-react";
import type { DestinationSearchResult, SelectedDestination } from "@/lib/destination-search/types";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function toSelected(result: DestinationSearchResult): SelectedDestination {
  return { freeText: false, ...result };
}

function freeTextFallback(raw: string): SelectedDestination {
  const trimmed = raw.trim();
  return { freeText: true, name: trimmed, displayName: trimmed };
}

export function DestinationAutocomplete({
  onAdd,
  isDuplicate,
}: {
  onAdd: (destination: SelectedDestination) => void;
  isDuplicate: (destination: SelectedDestination) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DestinationSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced search — aborts the in-flight request on every new
  // keystroke so a slow, stale response can never overwrite newer results.
  // Below the minimum length there's simply nothing to fetch; the dropdown
  // is already gated on length at render time, so no state reset is needed
  // here (avoids setState synchronously inside the effect body).
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      return;
    }

    const timeout = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setResults([]);

      fetch(`/api/destinations/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { results?: DestinationSearchResult[]; error?: string }) => {
          setResults(data.results ?? []);
          setError(data.error ?? null);
          setHighlighted(0);
          setOpen(true);
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          setResults([]);
          setError("Couldn't search right now — you can still add this as typed.");
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function commit(destination: SelectedDestination) {
    if (!destination.name) return;
    if (!isDuplicate(destination)) {
      onAdd(destination);
    }
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (open && results.length > 0) {
        setHighlighted((i) => (i + 1) % results.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open && results.length > 0) {
        setHighlighted((i) => (i - 1 + results.length) % results.length);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && results.length > 0) {
        commit(toSelected(results[highlighted]));
      } else if (query.trim()) {
        commit(freeTextFallback(query));
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const trimmedQuery = query.trim();
  const showDropdown = open && trimmedQuery.length >= MIN_QUERY_LENGTH;

  return (
    <div ref={wrapperRef} className="relative flex gap-2">
      <div className="relative flex-1">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => trimmedQuery.length >= MIN_QUERY_LENGTH && setOpen(true)}
          placeholder="Search a city, country or region…"
          autoFocus
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls="destination-search-results"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
        />

        {showDropdown && (
          <div
            id="destination-search-results"
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg"
          >
            {loading && (
              <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </div>
            )}

            {!loading && error && (
              <p className="px-4 py-3 text-xs text-danger">{error}</p>
            )}

            {!loading && !error && results.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No places found for &ldquo;{trimmedQuery}&rdquo;.
              </p>
            )}

            {!loading &&
              results.map((r, i) => (
                <button
                  key={r.providerPlaceId ?? r.displayName}
                  type="button"
                  role="option"
                  aria-selected={i === highlighted}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(toSelected(r))}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                    i === highlighted ? "bg-accent-tint text-accent-strong" : "text-foreground hover:bg-surface-muted"
                  }`}
                >
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{r.name}</span>
                    {r.country && <span className="text-muted-foreground">, {r.country}</span>}
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => query.trim() && commit(freeTextFallback(query))}
        disabled={!query.trim()}
        aria-label="Add destination"
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
