import type { MonthPoint } from '@compintel/contracts';
import { useId, useState } from 'react';

import { count, monthLabel, niceMax, type BarRow } from './insights-model.js';

/**
 * The Insights charts (WP-33, R69): hand-rolled, no library. Every chart is a
 * `<figure>` with a caption, a one-sentence accessible summary and a "Show as
 * table" view; values are written as text beside their marks in text colours,
 * so nothing is read from colour alone, and chart colours are the validated
 * `--ci-series-*` tokens of whichever flavour is on screen.
 */

export interface ChartFrameProps {
  readonly title: string;
  readonly summary: string;
  readonly table: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function ChartFrame({
  title,
  summary,
  table,
  children,
  className = '',
}: ChartFrameProps): React.JSX.Element {
  const id = useId();
  return (
    <figure
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-summary`}
      className={`ci-fx-card flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4 ${className}`}
    >
      <figcaption id={`${id}-title`} className="font-medium">
        {title}
      </figcaption>
      <p id={`${id}-summary`} className="sr-only">
        {summary}
      </p>
      {children}
      <details className="text-sm">
        <summary className="cursor-pointer text-fg-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

export function BarTable({
  rows,
  valueLabel,
}: {
  readonly rows: readonly BarRow[];
  readonly valueLabel: string;
}): React.JSX.Element {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-fg-muted">
          <th scope="col" className="py-1 pr-3 font-normal">
            Name
          </th>
          <th scope="col" className="py-1 pr-3 font-normal">
            {valueLabel}
          </th>
          <th scope="col" className="py-1 font-normal">
            Notes
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line">
            <th scope="row" className="py-1 pr-3 font-normal">
              {row.label}
            </th>
            <td className="py-1 pr-3 tabular-nums">{count(row.value)}</td>
            <td className="py-1 text-fg-muted">{row.detail ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Horizontal bars, one hue, each value written beside its bar. */
export function BarList({
  rows,
  max,
  empty,
}: {
  readonly rows: readonly BarRow[];
  /** Shared scale, e.g. the funnel's first step; defaults to the largest row. */
  readonly max?: number;
  readonly empty: string;
}): React.JSX.Element {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  const top = max ?? Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="ci-stagger flex flex-col gap-2" aria-hidden="true">
      {rows.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-3 text-sm"
          title={`${row.label}: ${count(row.value)}${row.detail === undefined ? '' : ` — ${row.detail}`}`}
        >
          <span className="truncate text-fg-muted">{row.label}</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
              <span
                className="ci-progress-fill block h-full w-full origin-left rounded-r-[4px]"
                style={{
                  background: 'var(--ci-series-1)',
                  transform: `scaleX(${String(top === 0 ? 0 : row.value / top)})`,
                }}
              />
            </span>
            <span className="shrink-0 tabular-nums">
              {count(row.value)}
              {row.detail !== undefined && (
                <span className="ml-1 text-xs text-fg-muted">{row.detail}</span>
              )}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const SERIES = [
  { key: 'assigned', label: 'Assigned that month', color: 'var(--ci-series-1)' },
  { key: 'active', label: 'Active at some point', color: 'var(--ci-series-2)' },
] as const;

/** Monthly columns, two series side by side, with a legend and a hover readout. */
export function MonthColumns({
  points,
}: {
  readonly points: readonly MonthPoint[];
}): React.JSX.Element {
  const [hover, setHover] = useState<number | undefined>(undefined);
  const width = 640;
  const height = 180;
  const left = 32;
  const bottom = 22;
  const plotHeight = height - bottom - 8;
  const top = niceMax(Math.max(...points.map((p) => Math.max(p.assigned, p.active)), 1));
  const slot = (width - left) / Math.max(points.length, 1);
  const bar = Math.max(2, Math.min(18, slot / 3));
  const y = (value: number): number => 8 + plotHeight - (value / top) * plotHeight;
  const labelEvery = Math.ceil(points.length / 12);
  const shown = hover === undefined ? undefined : points[hover];

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-4 text-sm" aria-hidden="true">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm" style={{ background: series.color }} />
            {series.label}
          </li>
        ))}
      </ul>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-auto w-full"
        aria-hidden="true"
        onMouseLeave={() => {
          setHover(undefined);
        }}
      >
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--ci-color-border)"
              strokeWidth={1}
            />
            <text
              x={left - 6}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--ci-color-text-subtle)"
            >
              {count(tick)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = left + index * slot + slot / 2;
          return (
            <g
              key={point.month}
              onMouseEnter={() => {
                setHover(index);
              }}
            >
              <rect x={x - slot / 2} y={0} width={slot} height={height} fill="transparent" />
              {SERIES.map((series, s) => {
                const value = point[series.key];
                const barTop = y(value);
                return (
                  <rect
                    key={series.key}
                    x={x - bar - 1 + s * (bar + 2)}
                    y={barTop}
                    width={bar}
                    height={Math.max(0, 8 + plotHeight - barTop)}
                    rx={Math.min(4, bar / 2)}
                    fill={series.color}
                    opacity={hover === undefined || hover === index ? 1 : 0.45}
                  />
                );
              })}
              {index % labelEvery === 0 && (
                <text
                  x={x}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--ci-color-text-subtle)"
                >
                  {monthLabel(point.month).replace(' 20', " '")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="min-h-5 text-sm text-fg-muted" aria-hidden="true">
        {shown === undefined
          ? 'Point at a month to read its numbers.'
          : `${monthLabel(shown.month)}: ${count(shown.assigned)} assigned, ${count(shown.active)} active`}
      </p>
    </div>
  );
}

export function MonthTable({
  points,
}: {
  readonly points: readonly MonthPoint[];
}): React.JSX.Element {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-fg-muted">
          <th scope="col" className="py-1 pr-3 font-normal">
            Month
          </th>
          <th scope="col" className="py-1 pr-3 font-normal">
            Assigned
          </th>
          <th scope="col" className="py-1 font-normal">
            Active
          </th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.month} className="border-t border-line">
            <th scope="row" className="py-1 pr-3 font-normal">
              {monthLabel(point.month)}
            </th>
            <td className="py-1 pr-3 tabular-nums">{count(point.assigned)}</td>
            <td className="py-1 tabular-nums">{count(point.active)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
