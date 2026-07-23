'use client';

/**
 * Typeahead over GET /locations/search (server-proxied Google Places — see
 * apps/api's LocationSearchService; the API key never reaches this
 * component, and the client never calls Places directly). Debounced
 * ~300ms so normal typing doesn't fire a request per keystroke.
 *
 * Must remain usable if the search service fails: any error (network,
 * 503 when GOOGLE_PLACES_API_KEY isn't configured, rate-limited) falls
 * back to plain free-text entry — the input keeps working, onChangeText
 * keeps firing, profile save is never blocked on this component.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface LocationSuggestion {
  placeId: string;
  city: string;
  region: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
}

interface Props {
  id: string;
  /** Current display text — a formatted "City, Region, Country" after a
   * selection, the pre-migration legacy string, or whatever free text the
   * candidate is currently typing. Fully controlled by the parent. */
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (suggestion: LocationSuggestion) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function LocationAutocomplete({ id, value, onChangeText, onSelect, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [serviceDown, setServiceDown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Selecting a suggestion sets `value` to that suggestion's own formatted
  // text — without this, the effect below would immediately re-search for
  // the text we just picked, only to show the same suggestion again.
  const skipNextSearchRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }

    const query = value.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api<LocationSuggestion[]>(`/locations/search?q=${encodeURIComponent(query)}`);
        setSuggestions(results);
        setOpen(results.length > 0);
        setServiceDown(false);
      } catch {
        setSuggestions([]);
        setOpen(false);
        setServiceDown(true);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  function pick(s: LocationSuggestion) {
    skipNextSearchRef.current = true;
    setSuggestions([]);
    setOpen(false);
    onSelect(s);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        id={id}
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        placeholder={placeholder}
        maxLength={120}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className="location-suggestions">
          {suggestions.map((s) => (
            <button
              type="button"
              key={s.placeId}
              className="location-suggestion"
              onClick={() => pick(s)}
            >
              {[s.city, s.region, s.country].filter(Boolean).join(', ')}
            </button>
          ))}
        </div>
      )}
      {serviceDown && (
        <p className="meta" style={{ margin: '4px 0 0' }}>
          City search isn&apos;t available right now — you can still type your location.
        </p>
      )}
    </div>
  );
}
