import {
  OPEN_REFUSAL_TEXT,
  RESOURCE_KIND_LABELS,
  type Resource,
  type ResourceKind,
  type ResourceOwnerKind,
} from '@compintel/contracts';
import {
  Cloud,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  HardDrive,
  Link,
  Link2,
  Paperclip,
  Pencil,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { useToast } from '../../components/toast/ToastProvider.js';
import { openExternal } from '../../lib/external.js';
import { useNow } from '../../lib/use-now.js';
import { openLocalPath, revealPath } from '../../shell/paths.js';
import { ItemMenu } from '../workflows/ItemMenu.js';
import { ConfirmRemoveDialog } from '../workflows/StageDialogs.js';
import { ResourceDialog } from './ResourceDialog.js';
import { rowState } from './resource-model.js';
import { PENDING_PREFIX, useResources } from './ResourcesScope.js';

/**
 * One owner's resources (WP-20b, §16.2): each row shows its kind as icon +
 * label, its label, and the status line; Open (links through the browser,
 * paths only when the shell said they may open), Show in Explorer, and Copy,
 * Edit and Remove in its menu. Removing confirms; adding offers Undo.
 */

export const KIND_ICONS: Readonly<Record<ResourceKind, LucideIcon>> = {
  URL: Link,
  GITHUB: GitBranch,
  CLOUD_DOC: Cloud,
  LOCAL_PATH: HardDrive,
  OTHER: Link2,
};

const BUTTON =
  'flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs hover:bg-surface-hover disabled:opacity-50';

export function ResourceRows({
  ownerKind,
  ownerId,
  ownerName,
  title,
  variant = 'section',
}: {
  readonly ownerKind: ResourceOwnerKind;
  readonly ownerId: string;
  /** "Build prototype", "Confirm the team", "this competition" — for labels. */
  readonly ownerName: string;
  /** A heading above the rows. */
  readonly title?: string;
  /** `compact` (a task's): only the rows, nothing when there are none, no Add button. */
  readonly variant?: 'section' | 'compact';
}): React.JSX.Element | null {
  const scope = useResources();
  const toast = useToast();
  const now = new Date(useNow());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Resource | undefined>(undefined);
  const [removing, setRemoving] = useState<Resource | undefined>(undefined);
  if (scope === undefined) return null;
  const rows = scope.of(ownerKind, ownerId);
  const canEdit = scope.list?.canEdit === true;
  const compact = variant === 'compact';
  if (compact && rows.length === 0) return null;

  const copy = (resource: Resource): void => {
    void navigator.clipboard.writeText(resource.uri).then(
      () => {
        toast.show({ tone: 'success', title: 'Copied' });
      },
      () => {
        toast.show({ tone: 'warning', title: 'Copy did not work', description: resource.uri });
      },
    );
  };

  const open = async (resource: Resource): Promise<void> => {
    if (resource.kind !== 'LOCAL_PATH') {
      if (!(await openExternal(resource.uri))) {
        toast.show({
          tone: 'warning',
          title: 'That link was not opened',
          description: resource.uri,
        });
      }
      return;
    }
    const result = await openLocalPath(resource.uri).catch(() => undefined);
    if (result?.done !== true) {
      toast.show({
        tone: 'warning',
        title: 'Not opened',
        description:
          result === undefined ? 'The app did not answer.' : OPEN_REFUSAL_TEXT[result.reason],
      });
    }
  };

  const reveal = async (resource: Resource): Promise<void> => {
    const result = await revealPath(resource.uri).catch(() => undefined);
    if (result?.done !== true) {
      toast.show({
        tone: 'warning',
        title: 'Not shown in Explorer',
        description:
          result === undefined ? 'The app did not answer.' : OPEN_REFUSAL_TEXT[result.reason],
      });
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {title !== undefined && <h4 className="text-sm font-medium">{title}</h4>}
      {rows.length === 0 && <p className="text-xs text-fg-muted">No links or files yet.</p>}
      {rows.length > 0 && (
        <ul aria-label={`Resources of ${ownerName}`} className="flex flex-col gap-1">
          {rows.map((resource) => {
            const Icon = KIND_ICONS[resource.kind];
            const pending = resource.id.startsWith(PENDING_PREFIX);
            const state = rowState({
              resource,
              shell: scope.shell,
              thisPc: scope.thisPc,
              stat: scope.stats.get(resource.uri),
              now,
            });
            return (
              <li
                key={resource.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1 text-sm"
              >
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <Icon aria-hidden="true" className="size-4" />
                  <span className="sr-only">{RESOURCE_KIND_LABELS[resource.kind]}:</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium" title={resource.uri}>
                    {resource.label}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {RESOURCE_KIND_LABELS[resource.kind]}
                    {state.line !== undefined && (
                      <span className={state.warn ? 'text-warning' : undefined}>
                        {state.warn && (
                          <TriangleAlert aria-hidden="true" className="ml-1 inline size-3.5" />
                        )}{' '}
                        · {state.line}
                      </span>
                    )}
                  </span>
                </span>
                {!pending && state.canOpen && (
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={`Open ${resource.label}`}
                    onClick={() => {
                      void open(resource);
                    }}
                  >
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    Open
                  </button>
                )}
                {!pending && state.canReveal && (
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={`Show ${resource.label} in Explorer`}
                    onClick={() => {
                      void reveal(resource);
                    }}
                  >
                    <FolderOpen aria-hidden="true" className="size-3.5" />
                    Show in Explorer
                  </button>
                )}
                {!pending && (
                  <ItemMenu
                    name={resource.label}
                    items={[
                      {
                        label: 'Copy',
                        icon: Copy,
                        onSelect: () => {
                          copy(resource);
                        },
                      },
                      ...(canEdit
                        ? [
                            {
                              label: 'Edit',
                              icon: Pencil,
                              onSelect: () => {
                                setEditing(resource);
                              },
                            },
                            {
                              label: 'Remove',
                              icon: Trash2,
                              onSelect: () => {
                                setRemoving(resource);
                              },
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && !compact && (
        <button
          type="button"
          className={`${BUTTON} w-fit`}
          aria-label={`Add a resource to ${ownerName}`}
          onClick={() => {
            setAdding(true);
          }}
        >
          <Paperclip aria-hidden="true" className="size-3.5" />
          Add resource
        </button>
      )}
      {adding && (
        <ResourceDialog
          title={`Add a resource to ${ownerName}`}
          shell={scope.shell}
          onClose={() => {
            setAdding(false);
          }}
          onSubmit={(draft) =>
            scope.add({
              ownerKind,
              ownerId,
              uri: draft.uri,
              ...(draft.kind === undefined ? {} : { kind: draft.kind }),
              ...(draft.label === undefined ? {} : { label: draft.label }),
            })
          }
        />
      )}
      {editing !== undefined && (
        <ResourceDialog
          title={`Edit “${editing.label}”`}
          initial={editing}
          shell={scope.shell}
          onClose={() => {
            setEditing(undefined);
          }}
          onSubmit={(draft) =>
            scope.update(editing, {
              ...(draft.uri === editing.uri ? {} : { uri: draft.uri }),
              ...(draft.kind === undefined || draft.kind === editing.kind
                ? {}
                : { kind: draft.kind }),
              ...(draft.label === undefined || draft.label === editing.label
                ? {}
                : { label: draft.label }),
            })
          }
        />
      )}
      {removing !== undefined && (
        <ConfirmRemoveDialog
          what={`“${removing.label}”`}
          detail="Only the link is removed; the file or page itself is not touched."
          onAnswer={(yes) => {
            const resource = removing;
            setRemoving(undefined);
            if (yes) void scope.remove(resource);
          }}
        />
      )}
    </div>
  );
}
