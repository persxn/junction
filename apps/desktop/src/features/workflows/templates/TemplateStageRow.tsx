import {
  DEADLINE_KINDS,
  DUE_ANCHORS,
  DUE_ANCHOR_LABELS,
  DUE_OFFSET_MAX,
  STAGE_WEIGHT_MAX,
  type DeadlineKind,
  type DueAnchor,
  type DueRule,
  type TemplateStage,
} from '@compintel/contracts';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { DEADLINE_KIND_LABELS } from '../../discover/detail/DeadlineTimeline.js';
import { ItemMenu } from '../ItemMenu.js';
import { ruleText } from './rule-text.js';

/**
 * One stage of a template (WP-20a step 8): read as words, or — for its owner
 * or an admin — edited as a form: name, weight 0–10, the date rule as anchor +
 * days, and the default tasks one per line.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1 text-sm';

export interface StageEdit {
  readonly name: string;
  readonly weight: number;
  readonly dueRule: DueRule | null;
  readonly defaultTasks: string[];
}

export function TemplateStageRow({
  stage,
  index,
  count,
  editable,
  onSave,
  onMove,
  onRemove,
}: {
  readonly stage: TemplateStage;
  readonly index: number;
  readonly count: number;
  readonly editable: boolean;
  readonly onSave: (edit: StageEdit) => void;
  readonly onMove: (direction: 'up' | 'down') => void;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const id = useId();
  const [name, setName] = useState(stage.name);
  const [weight, setWeight] = useState(String(stage.weight));
  const [anchor, setAnchor] = useState<DueAnchor | ''>(stage.dueRule?.anchor ?? '');
  const [kind, setKind] = useState<DeadlineKind>(stage.dueRule?.kind ?? 'FINAL_SUBMISSION');
  const [offset, setOffset] = useState(String(stage.dueRule?.offsetDays ?? 0));
  const [tasks, setTasks] = useState(stage.defaultTasks.join('\n'));

  if (!editable) {
    return (
      <li className="flex flex-col gap-0.5 rounded-md border border-line px-3 py-2 text-sm">
        <span className="font-medium">
          {stage.name} <span className="text-xs text-fg-muted">· weight {stage.weight}</span>
        </span>
        <span className="text-xs text-fg-muted">{ruleText(stage.dueRule)}</span>
        {stage.defaultTasks.length > 0 && (
          <ul className="list-disc pl-5 text-fg-muted">
            {stage.defaultTasks.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  const weightValue = Number(weight);
  const offsetValue = Number(offset);
  const valid =
    name.trim() !== '' &&
    Number.isInteger(weightValue) &&
    weightValue >= 0 &&
    weightValue <= STAGE_WEIGHT_MAX &&
    Number.isInteger(offsetValue) &&
    Math.abs(offsetValue) <= DUE_OFFSET_MAX;
  const rule: DueRule | null =
    anchor === ''
      ? null
      : anchor === 'DEADLINE'
        ? { anchor, kind, offsetDays: offsetValue }
        : { anchor, offsetDays: offsetValue };

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSave({
            name: name.trim(),
            weight: weightValue,
            dueRule: rule,
            defaultTasks: tasks
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== ''),
          });
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={`${id}-name`} className="flex flex-1 flex-col gap-0.5">
            Stage name
            <input
              id={`${id}-name`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className={FIELD}
            />
          </label>
          <label htmlFor={`${id}-weight`} className="flex flex-col gap-0.5">
            Weight (0–{STAGE_WEIGHT_MAX})
            <input
              id={`${id}-weight`}
              type="number"
              min={0}
              max={STAGE_WEIGHT_MAX}
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
              }}
              className={`${FIELD} w-20`}
            />
          </label>
          <ItemMenu
            name={stage.name}
            items={[
              {
                label: 'Move up',
                icon: ArrowUp,
                disabled: index === 0,
                onSelect: () => onMove('up'),
              },
              {
                label: 'Move down',
                icon: ArrowDown,
                disabled: index === count - 1,
                onSelect: () => onMove('down'),
              },
              { label: 'Remove', icon: Trash2, onSelect: onRemove },
            ]}
          />
        </div>
        <fieldset className="flex flex-wrap items-end gap-2">
          <legend className="mb-1">Date rule: {ruleText(rule)}</legend>
          <label htmlFor={`${id}-offset`} className="flex flex-col gap-0.5">
            Days (− before, + after)
            <input
              id={`${id}-offset`}
              type="number"
              min={-DUE_OFFSET_MAX}
              max={DUE_OFFSET_MAX}
              value={offset}
              disabled={anchor === ''}
              onChange={(e) => {
                setOffset(e.target.value);
              }}
              className={`${FIELD} w-24`}
            />
          </label>
          <label htmlFor={`${id}-anchor`} className="flex flex-col gap-0.5">
            From
            <select
              id={`${id}-anchor`}
              value={anchor}
              onChange={(e) => {
                setAnchor(e.target.value as DueAnchor | '');
              }}
              className={FIELD}
            >
              <option value="">No rule</option>
              {DUE_ANCHORS.map((value) => (
                <option key={value} value={value}>
                  {DUE_ANCHOR_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {anchor === 'DEADLINE' && (
            <label htmlFor={`${id}-kind`} className="flex flex-col gap-0.5">
              Which date
              <select
                id={`${id}-kind`}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as DeadlineKind);
                }}
                className={FIELD}
              >
                {DEADLINE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {DEADLINE_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        <label htmlFor={`${id}-tasks`} className="flex flex-col gap-0.5">
          Default tasks, one per line
          <textarea
            id={`${id}-tasks`}
            rows={3}
            value={tasks}
            onChange={(e) => {
              setTasks(e.target.value);
            }}
            className={FIELD}
          />
        </label>
        <button
          type="submit"
          disabled={!valid}
          className="w-fit rounded-md border border-line px-3 py-1 hover:bg-surface-hover disabled:opacity-50"
        >
          Save stage
        </button>
      </form>
    </li>
  );
}
