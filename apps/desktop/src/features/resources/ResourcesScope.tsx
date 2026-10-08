import type {
  Resource,
  ResourceCreateRequest,
  ResourceList,
  ResourceOwnerKind,
  ResourceUpdateRequest,
} from '@compintel/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  createResource,
  deleteResource,
  listResources,
  postCheckResults,
  updateResource,
} from '../../api/resources.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { inShell, machineLabel, statPaths } from '../../shell/paths.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { sameMachine, type PathStat } from './resource-model.js';

/**
 * One competition's resources for its whole page (WP-20b): fetched once, the
 * paths added on this PC checked by the shell as the page opens and the
 * results posted back (machine state, R103), and the writes — an optimistic
 * add with Undo, edits, and removals that the caller has confirmed.
 */

export const resourcesKey = (competitionId: string) => ['resources', competitionId] as const;

export interface ResourcesApi {
  readonly competitionId: string;
  readonly list: ResourceList | undefined;
  readonly error: unknown;
  readonly shell: boolean;
  readonly thisPc: string | undefined;
  readonly stats: ReadonlyMap<string, PathStat>;
  readonly of: (ownerKind: ResourceOwnerKind, ownerId: string) => readonly Resource[];
  readonly add: (request: ResourceCreateRequest) => Promise<string | undefined>;
  readonly update: (
    resource: Resource,
    patch: Omit<ResourceUpdateRequest, 'version'>,
  ) => Promise<string | undefined>;
  readonly remove: (resource: Resource) => Promise<void>;
  readonly retry: () => void;
}

const ResourcesContext = createContext<ResourcesApi | undefined>(undefined);

export function useResources(): ResourcesApi | undefined {
  return useContext(ResourcesContext);
}

const failureText = (cause: unknown): string => problemText(cause);

/** A row's id while its add is in flight; rows with it offer no actions. */
export const PENDING_PREFIX = 'pending-';

function withPending(
  list: ResourceList,
  request: ResourceCreateRequest,
  thisPc: string | undefined,
): ResourceList {
  const pending: Resource = {
    id: `${PENDING_PREFIX}${String(Date.now())}`,
    ownerKind: request.ownerKind,
    ownerId: request.ownerId,
    kind: request.kind ?? 'OTHER',
    label: request.label ?? request.uri,
    uri: request.uri,
    machineLabel: thisPc ?? null,
    checkStatus: 'UNCHECKED',
    lastCheckedAt: null,
    addedBy: 'You',
    addedAt: new Date().toISOString(),
    version: 1,
  };
  const found = list.groups.some(
    (group) => group.ownerKind === request.ownerKind && group.ownerId === request.ownerId,
  );
  return {
    ...list,
    groups: found
      ? list.groups.map((group) =>
          group.ownerKind === request.ownerKind && group.ownerId === request.ownerId
            ? { ...group, resources: [...group.resources, pending] }
            : group,
        )
      : [
          ...list.groups,
          {
            ownerKind: request.ownerKind,
            ownerId: request.ownerId,
            ownerLabel: '',
            resources: [pending],
          },
        ],
  };
}

export function ResourcesScope({
  competitionId,
  children,
}: {
  readonly competitionId: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const shell = inShell();
  const key = resourcesKey(competitionId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => listResources(connection, competitionId),
  });
  const pc = useQuery({
    queryKey: ['machine-label'],
    queryFn: machineLabel,
    enabled: shell,
    staleTime: Infinity,
  });
  const [stats, setStats] = useState<ReadonlyMap<string, PathStat>>(new Map());

  const all = useMemo(
    () => query.data?.groups.flatMap((group) => group.resources) ?? [],
    [query.data],
  );
  const mine = useMemo(
    () =>
      all.filter((resource) => resource.kind === 'LOCAL_PATH' && sameMachine(resource, pc.data)),
    [all, pc.data],
  );
  const pathsKey = mine
    .map((resource) => resource.uri)
    .sort()
    .join('\n');

  // R103: the shell checks the paths this PC can see, on view; the backend never does.
  useEffect(() => {
    if (!shell || mine.length === 0) return;
    let live = true;
    const paths = [...new Set(mine.map((resource) => resource.uri))];
    statPaths(paths).then(
      (answer) => {
        if (!live) return;
        const byPath = new Map(answer.results.map((result) => [result.path, result]));
        setStats(byPath);
        const checkedAt = new Date().toISOString();
        void postCheckResults(connection, {
          results: mine.flatMap((resource) => {
            const stat = byPath.get(resource.uri);
            return stat === undefined ? [] : [{ id: resource.id, status: stat.status, checkedAt }];
          }),
        }).catch(() => undefined);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // `pathsKey` stands for `mine`; the array is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell, pathsKey, connection]);

  const api = useMemo<ResourcesApi>(() => {
    const refresh = (): void => {
      void client.invalidateQueries({ queryKey: key });
    };
    const remove = async (resource: Resource): Promise<void> => {
      try {
        await deleteResource(connection, resource.id, resource.version);
      } catch (cause) {
        toast.show({
          tone: 'danger',
          title: 'The resource was not removed',
          description: failureText(cause),
        });
      }
      refresh();
    };
    return {
      competitionId,
      list: query.data,
      error: query.error,
      shell,
      thisPc: pc.data,
      stats,
      of: (ownerKind, ownerId) =>
        query.data?.groups.find(
          (group) => group.ownerKind === ownerKind && group.ownerId === ownerId,
        )?.resources ?? [],
      add: async (request) => {
        // Shown at once; the server's answer replaces it a moment later.
        client.setQueryData<ResourceList>(key, (current) =>
          current === undefined ? current : withPending(current, request, pc.data),
        );
        try {
          const made = await createResource(connection, {
            ...request,
            ...(shell && pc.data !== undefined ? { machineLabel: pc.data } : {}),
          });
          refresh();
          toast.show({
            tone: 'success',
            title: `Added “${made.label}”`,
            action: {
              label: 'Undo',
              onAction: () => {
                void remove(made);
              },
            },
          });
          return undefined;
        } catch (cause) {
          refresh();
          return failureText(cause);
        }
      },
      update: async (resource, patch) => {
        try {
          await updateResource(connection, resource.id, { ...patch, version: resource.version });
          refresh();
          return undefined;
        } catch (cause) {
          refresh();
          return failureText(cause);
        }
      },
      remove,
      retry: refresh,
    };
    // `key` is derived from `competitionId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, competitionId, connection, pc.data, query.data, query.error, shell, stats, toast]);

  return <ResourcesContext.Provider value={api}>{children}</ResourcesContext.Provider>;
}
