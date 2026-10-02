import {
  PROFICIENCY_LABELS,
  proficiencyLabel,
  type Proficiency,
  type StudentDetail,
  type TagRelation,
} from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { suggestTags } from '../../api/students.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { tagSetOf, useStudentActions } from './use-student-actions.js';

/**
 * Skills and interests (§16.2, R91). A skill carries a level in words —
 * Beginner, Intermediate, Advanced or "Not rated"; an interest carries none.
 * Adding offers names already in use (the typeahead) and creates a new one on
 * save. Every change is optimistic with Undo.
 */

const LEVELS: readonly (Proficiency | null)[] = [null, 1, 2, 3];

function AddTag(props: {
  readonly relation: TagRelation;
  readonly onAdd: (name: string, proficiency: Proficiency | null) => void;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const inputId = useId();
  const listId = useId();
  const levelId = useId();
  const [text, setText] = useState('');
  const [level, setLevel] = useState<Proficiency | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);
  const suggestions = useQuery({
    queryKey: ['tags', props.relation, query],
    queryFn: () => suggestTags(connection, props.relation, query),
    enabled: query.length > 0,
  });
  const label = props.relation === 'SKILL' ? 'Add a skill' : 'Add an interest';
  const submit = (): void => {
    const name = text.trim();
    if (name.length === 0) return;
    props.onAdd(name, props.relation === 'SKILL' ? level : null);
    setText('');
    setLevel(null);
  };
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm text-fg-subtle">
          {label}
        </label>
        <input
          id={inputId}
          list={listId}
          value={text}
          maxLength={60}
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
          }}
          className="w-48 rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
        <datalist id={listId}>
          {(suggestions.data ?? []).map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
      </div>
      {props.relation === 'SKILL' && (
        <div className="flex flex-col gap-1">
          <label htmlFor={levelId} className="text-sm text-fg-subtle">
            Level
          </label>
          <select
            id={levelId}
            value={level === null ? '' : String(level)}
            onChange={(event) => {
              setLevel(
                event.target.value === '' ? null : (Number(event.target.value) as Proficiency),
              );
            }}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {LEVELS.map((value) => (
              <option key={String(value)} value={value === null ? '' : String(value)}>
                {proficiencyLabel(value)}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="submit"
        disabled={text.trim().length === 0}
        className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        Add
      </button>
    </form>
  );
}

export function TagEditor({ student }: { readonly student: StudentDetail }): React.JSX.Element {
  const actions = useStudentActions();
  const current = tagSetOf(student);
  const readOnly = student.erasedAt !== null;

  const group = (relation: TagRelation, title: string, empty: string): React.JSX.Element => {
    const tags = current.filter((tag) => tag.relation === relation);
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {tags.length === 0 ? (
          <p className="text-sm text-fg-muted">{empty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                key={`${tag.relation}:${tag.name}`}
                className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-sm"
              >
                <span>{tag.name}</span>
                {relation === 'SKILL' && (
                  <>
                    <span aria-hidden="true" className="text-fg-subtle">
                      ·
                    </span>
                    <label className="sr-only" htmlFor={`level-${tag.name}`}>
                      Level of {tag.name}
                    </label>
                    <select
                      id={`level-${tag.name}`}
                      disabled={readOnly}
                      value={tag.proficiency === null ? '' : String(tag.proficiency)}
                      onChange={(event) => {
                        const proficiency =
                          event.target.value === ''
                            ? null
                            : (Number(event.target.value) as Proficiency);
                        actions.saveTags(
                          student,
                          current.map((held) => (held === tag ? { ...held, proficiency } : held)),
                          `${tag.name}: ${proficiencyLabel(proficiency)}`,
                        );
                      }}
                      className="bg-transparent text-fg-muted"
                    >
                      {LEVELS.map((value) => (
                        <option key={String(value)} value={value === null ? '' : String(value)}>
                          {value === null ? 'Not rated' : PROFICIENCY_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${tag.name}`}
                    onClick={() => {
                      actions.saveTags(
                        student,
                        current.filter((held) => held !== tag),
                        `Removed ${tag.name}`,
                      );
                    }}
                    className="rounded-full p-0.5 text-fg-subtle hover:bg-surface-hover hover:text-fg"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <AddTag
            relation={relation}
            onAdd={(name, proficiency) => {
              if (
                current.some(
                  (held) =>
                    held.relation === relation && held.name.toLowerCase() === name.toLowerCase(),
                )
              ) {
                return;
              }
              actions.saveTags(
                student,
                [...current, { name, relation, proficiency }],
                `Added ${name}`,
              );
            }}
          />
        )}
      </div>
    );
  };

  return (
    <section aria-labelledby="skills-heading" className="flex flex-col gap-4">
      <h2 id="skills-heading" className="text-md">
        Skills and interests
      </h2>
      {group('SKILL', 'Skills', 'No skills recorded yet.')}
      {group('INTEREST', 'Interests', 'No interests recorded yet.')}
    </section>
  );
}
