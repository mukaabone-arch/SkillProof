'use client';

/**
 * Typeahead over a small local option list — the same input+dropdown
 * interaction as LocationAutocomplete (type to filter, click a suggestion,
 * outside-click closes), but with no network call and no debounce: the
 * option list is static reference data, filtered synchronously on every
 * keystroke. Reuses LocationAutocomplete's .location-suggestions/
 * -suggestion styling (generic enough for either). Unlike
 * LocationAutocomplete there's no free-text fallback — a selection must
 * come from `options`; closing without picking one reverts the displayed
 * text to whatever was last selected.
 */
import { useEffect, useRef, useState } from 'react';

export interface SearchableSelectOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  id: string;
  options: SearchableSelectOption<T>[];
  /** Currently selected option's value, or '' for "nothing selected" — same convention as a plain <select>. */
  value: T | '';
  onSelect: (value: T) => void;
  placeholder?: string;
}

export function SearchableSelect<T extends string>({ id, options, value, onSelect, placeholder }: Props<T>) {
  const [query, setQuery] = useState(options.find((o) => o.value === value)?.label ?? '');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keeps the displayed text in sync when `value` changes from outside
  // (e.g. the parent reloads the form after a save) rather than from a
  // pick in this component.
  useEffect(() => {
    setQuery(options.find((o) => o.value === value)?.label ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(options.find((o) => o.value === value)?.label ?? '');
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  function pick(o: SearchableSelectOption<T>) {
    setQuery(o.label);
    setOpen(false);
    onSelect(o.value);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="location-suggestions">
          {filtered.map((o) => (
            <button type="button" key={o.value} className="location-suggestion" onClick={() => pick(o)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
