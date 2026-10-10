import type { BackendConnection, PlaceSuggestion } from '@compintel/contracts';
import { Building2, MapPin } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { suggestPlaces } from '../../api/setup.js';
import type { PlaceValue } from './student-wizard-state.js';

/**
 * "Where are you?" without typing coordinates (WP-34). Suggestions come from the
 * offline gazetteer and the institutions list (`GET /setup/places`); picking one
 * fills the label and the coordinates. Typed coordinates remain the fallback for
 * a place the list does not know.
 */

export interface PlacePickerProps {
  readonly connection: BackendConnection;
  readonly label: string;
  readonly value: PlaceValue;
  readonly error: string | undefined;
  readonly onChange: (value: PlaceValue) => void;
  /** Institutions first (an institution's campus) or as they come. */
  readonly preferInstitutions?: boolean;
}

/** Waits this long after the last keystroke before asking. */
const DEBOUNCE_MS = 200;

export function PlacePicker({
  connection,
  label,
  value,
  error,
  onChange,
  preferInstitutions = false,
}: PlacePickerProps): React.JSX.Element {
  const ids = { input: useId(), list: useId(), error: useId(), lat: useId(), lon: useId() };
  const [typed, setTyped] = useState(value.label);
  const [places, setPlaces] = useState<readonly PlaceSuggestion[]>([]);
  const [manual, setManual] = useState(false);
  const chosen = value.lat !== '' && value.label === typed;

  const asking = !chosen && typed.trim().length >= 2;
  useEffect(() => {
    if (!asking) return;
    let current = true;
    const timer = setTimeout(() => {
      suggestPlaces(connection, typed).then(
        (found) => {
          if (!current) return;
          setPlaces(
            preferInstitutions
              ? [...found].sort(
                  (a, b) => Number(b.kind === 'INSTITUTION') - Number(a.kind === 'INSTITUTION'),
                )
              : found,
          );
        },
        () => {
          if (current) setPlaces([]);
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [connection, typed, asking, preferInstitutions]);
  // Nothing to suggest once a place is chosen or the text is too short.
  const shown = asking ? places : [];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={ids.input} className="font-medium">
        {label}
      </label>
      <input
        id={ids.input}
        value={typed}
        autoComplete="off"
        placeholder="Start typing a city or college"
        aria-describedby={error === undefined ? ids.list : `${ids.list} ${ids.error}`}
        aria-invalid={error !== undefined}
        onChange={(event) => {
          setTyped(event.target.value);
          onChange({
            label: event.target.value,
            lat: manual ? value.lat : '',
            lon: manual ? value.lon : '',
          });
        }}
        className="rounded-md border border-line bg-surface px-3 py-2 text-fg"
      />
      <div id={ids.list} aria-live="polite" className="flex flex-col gap-1">
        {chosen && (
          <p className="text-sm text-fg-muted">
            Using {value.label} ({Number(value.lat).toFixed(3)}, {Number(value.lon).toFixed(3)}).
          </p>
        )}
        {shown.length > 0 && (
          <ul aria-label="Suggestions" className="flex flex-col rounded-md border border-line">
            {shown.map((place) => {
              const Icon = place.kind === 'INSTITUTION' ? Building2 : MapPin;
              return (
                <li key={`${place.kind}:${place.label}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setTyped(place.label);
                      setPlaces([]);
                      onChange({
                        label: place.label,
                        lat: String(place.lat),
                        lon: String(place.lon),
                      });
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                    <span>{place.label}</span>
                    <span className="sr-only">
                      {place.kind === 'INSTITUTION' ? '(institution)' : '(city)'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error !== undefined && (
        <p id={ids.error} className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setManual((open) => !open);
        }}
        aria-expanded={manual}
        className="self-start text-sm text-accent underline-offset-2 hover:underline"
      >
        {manual ? 'Hide coordinates' : 'Enter coordinates instead'}
      </button>
      {manual && (
        <div className="flex gap-3">
          {(['lat', 'lon'] as const).map((axis) => (
            <div key={axis} className="flex flex-1 flex-col gap-1">
              <label htmlFor={ids[axis]} className="text-sm font-medium">
                {axis === 'lat' ? 'Latitude' : 'Longitude'}
              </label>
              <input
                id={ids[axis]}
                inputMode="decimal"
                value={value[axis]}
                onChange={(event) => {
                  onChange({ ...value, label: typed, [axis]: event.target.value });
                }}
                className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-fg"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
