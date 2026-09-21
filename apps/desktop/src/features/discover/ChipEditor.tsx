import {
  DISTANCE_BUCKETS_KM,
  EVENT_MODES,
  EVENT_TYPES,
  REG_STATES,
  type FacetValue,
  type Facets,
} from '@compintel/contracts';
import { useId } from 'react';

import { EVENT_TYPE_LABELS, MODE_LABELS, REG_STATE_LABELS } from './labels.js';
import { readChip, writeChip, type ChipId, type FilterQuery } from './query.js';

/**
 * What each chip's popover edits. Every control writes through `writeChip`, so
 * the popover cannot produce a filter the contract cannot express, and every
 * `includeUnknown` toggle sits inside the chip it belongs to (A6).
 */

export interface ChipEditorProps {
  readonly id: ChipId;
  readonly filters: FilterQuery;
  readonly facets: Facets | undefined;
  readonly onChange: (filters: FilterQuery) => void;
}

const countOf = (values: readonly FacetValue[] | undefined, value: string): string => {
  const count = values?.find((entry) => entry.value === value)?.count;
  return count === undefined ? '' : ` (${String(count)})`;
};

function CheckList<T extends string>({
  legend,
  options,
  chosen,
  onToggle,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  chosen: readonly T[];
  onToggle: (value: T, on: boolean) => void;
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chosen.includes(option.value)}
            onChange={(event) => {
              onToggle(option.value, event.target.checked);
            }}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

function Toggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  return (
    <label className={`mt-2 flex items-center gap-2 text-sm ${disabled ? 'text-fg-subtle' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number | undefined;
  min: number;
  onChange: (value: number | undefined) => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          onChange(Number.isFinite(next) && next >= min ? next : undefined);
        }}
        className="rounded-md border border-line bg-surface px-2 py-1"
      />
    </div>
  );
}

const toggle = <T,>(list: readonly T[], value: T, on: boolean): T[] =>
  on ? [...list.filter((item) => item !== value), value] : list.filter((item) => item !== value);

export function ChipEditor({ id, filters, facets, onChange }: ChipEditorProps): React.JSX.Element {
  const dateFrom = useId();
  const dateTo = useId();
  switch (id) {
    case 'eventType': {
      const chosen = readChip(filters, 'eventType');
      return (
        <CheckList
          legend="Event type"
          options={EVENT_TYPES.map((value) => ({
            value,
            label: `${EVENT_TYPE_LABELS[value]}${countOf(facets?.eventType, value)}`,
          }))}
          chosen={chosen}
          onToggle={(value, on) => {
            onChange(writeChip(filters, 'eventType', toggle(chosen, value, on)));
          }}
        />
      );
    }
    case 'category': {
      const chosen = readChip(filters, 'category');
      const options = (facets?.category ?? [])
        .filter((entry) => entry.value !== 'OTHER')
        .map((entry) => ({ value: entry.value, label: `${entry.label} (${String(entry.count)})` }));
      return options.length === 0 ? (
        <p className="text-sm text-fg-muted">No categories yet — an administrator adds them.</p>
      ) : (
        <CheckList
          legend="Category"
          options={options}
          chosen={chosen}
          onToggle={(value, on) => {
            onChange(writeChip(filters, 'category', toggle(chosen, value, on)));
          }}
        />
      );
    }
    case 'mode': {
      const chosen = readChip(filters, 'mode');
      return (
        <CheckList
          legend="Mode"
          options={EVENT_MODES.map((value) => ({
            value,
            label: `${MODE_LABELS[value]}${countOf(facets?.mode, value)}`,
          }))}
          chosen={chosen}
          onToggle={(value, on) => {
            onChange(writeChip(filters, 'mode', toggle(chosen, value, on)));
          }}
        />
      );
    }
    case 'distance': {
      const value = readChip(filters, 'distance');
      const radios = [...DISTANCE_BUCKETS_KM, undefined] as const;
      return (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Straight-line distance from campus</legend>
          {radios.map((km) => (
            <label key={km ?? 'anywhere'} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="distance"
                checked={value.km === km}
                onChange={() => {
                  onChange(writeChip(filters, 'distance', { ...value, km }));
                }}
              />
              {km === undefined ? 'Anywhere' : `Within ${String(km)} km`}
              {countOf(facets?.distanceBucket, km === undefined ? 'ANYWHERE' : String(km))}
            </label>
          ))}
          <Toggle
            label="Include in-person events with unknown location"
            checked={value.includeUnknown}
            disabled={value.km === undefined}
            onChange={(on) => {
              onChange(writeChip(filters, 'distance', { ...value, includeUnknown: on }));
            }}
          />
        </fieldset>
      );
    }
    case 'registration': {
      const value = readChip(filters, 'registration');
      return (
        <div>
          <CheckList
            legend="Registration"
            options={REG_STATES.map((state) => ({
              value: state,
              label: `${REG_STATE_LABELS[state]}${countOf(facets?.registrationState, state)}`,
            }))}
            chosen={value.states}
            onToggle={(state, on) => {
              onChange(
                writeChip(filters, 'registration', {
                  ...value,
                  states: toggle(value.states, state, on),
                }),
              );
            }}
          />
          <Toggle
            label="Include events with unknown deadline"
            checked={value.includeUnknown}
            disabled={value.states.length === 0}
            onChange={(on) => {
              onChange(writeChip(filters, 'registration', { ...value, includeUnknown: on }));
            }}
          />
        </div>
      );
    }
    case 'dates': {
      const value = readChip(filters, 'dates');
      const set = (patch: Partial<typeof value>): void => {
        const next = { ...value, ...patch };
        // A range that ends before it starts is not a range; keep the last good one.
        if (next.from !== undefined && next.to !== undefined && next.from > next.to) return;
        onChange(writeChip(filters, 'dates', next));
      };
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Event runs between</legend>
          <label htmlFor={dateFrom} className="text-sm">
            From
          </label>
          <input
            id={dateFrom}
            type="date"
            value={value.from ?? ''}
            onChange={(event) => {
              set({ from: event.target.value === '' ? undefined : event.target.value });
            }}
            className="rounded-md border border-line bg-surface px-2 py-1"
          />
          <label htmlFor={dateTo} className="text-sm">
            To
          </label>
          <input
            id={dateTo}
            type="date"
            value={value.to ?? ''}
            onChange={(event) => {
              set({ to: event.target.value === '' ? undefined : event.target.value });
            }}
            className="rounded-md border border-line bg-surface px-2 py-1"
          />
        </fieldset>
      );
    }
    case 'teamSize': {
      const value = readChip(filters, 'teamSize');
      return (
        <div>
          <NumberField
            label="Our team has this many members"
            value={value.fits}
            min={1}
            onChange={(fits) => {
              onChange(writeChip(filters, 'teamSize', { ...value, fits }));
            }}
          />
          <Toggle
            label="Include events with unknown team size"
            checked={value.includeUnknown}
            disabled={value.fits === undefined}
            onChange={(on) => {
              onChange(writeChip(filters, 'teamSize', { ...value, includeUnknown: on }));
            }}
          />
        </div>
      );
    }
    case 'fee': {
      const value = readChip(filters, 'fee');
      return (
        <div className="flex flex-col gap-2">
          <Toggle
            label="Free only"
            checked={value.freeOnly}
            onChange={(on) => {
              onChange(writeChip(filters, 'fee', { ...value, freeOnly: on }));
            }}
          />
          {!value.freeOnly && (
            <NumberField
              label="Maximum fee (₹)"
              value={value.maxRupees}
              min={0}
              onChange={(maxRupees) => {
                onChange(writeChip(filters, 'fee', { ...value, maxRupees }));
              }}
            />
          )}
          <Toggle
            label={
              value.freeOnly
                ? 'Include events with unknown fee (not with “Free only”)'
                : 'Include events with unknown fee'
            }
            checked={value.includeUnknown}
            disabled={value.freeOnly || value.maxRupees === undefined}
            onChange={(on) => {
              onChange(writeChip(filters, 'fee', { ...value, includeUnknown: on }));
            }}
          />
        </div>
      );
    }
    case 'prize': {
      const value = readChip(filters, 'prize');
      return (
        <NumberField
          label="Minimum prize (₹)"
          value={value.minRupees}
          min={1}
          onChange={(minRupees) => {
            onChange(writeChip(filters, 'prize', { minRupees }));
          }}
        />
      );
    }
  }
}
