import {
  problemType,
  type Resource,
  type ResourceKind,
  type ResourceList,
  type ResourceOwnerKind,
} from '@compintel/contracts';
import { vi } from 'vitest';

/**
 * The WP-20b backend, as far as its screens can tell — in memory, synthetic
 * only (D-33): one competition's resources, adding (with a light version of
 * the kind detection and its refusals), editing, removing and check results.
 * Everything else goes to the fake installed before it.
 */

export interface ResourcesApi {
  readonly resources: Map<string, Resource>;
  readonly calls: { method: string; path: string; body: Record<string, unknown> | undefined }[];
}

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(status === 204 ? '' : JSON.stringify(body)),
  }) as unknown as Response;

const problem = (status: number, code: string, detail: string): Response =>
  respond(status, {
    type: problemType(code as never),
    title: detail,
    status,
    code,
    detail,
    requestId: 'r',
  });

let serial = 0;
const nextId = (): string => {
  serial += 1;
  return `0192f0c1-0000-7000-8000-${(0xc000 + serial).toString(16).padStart(12, '0')}`;
};

/** Enough of `domain/resources/classify` for the screens: the real rules are tested in the backend. */
export function detectKind(uri: string): ResourceKind | undefined {
  if (/^[A-Za-z]:[\\/]/.test(uri) || /^\\\\[^\\]+\\[^\\]+/.test(uri)) return 'LOCAL_PATH';
  if (!/^https?:\/\//i.test(uri)) return undefined;
  if (/^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/i.test(uri)) return 'GITHUB';
  if (/^https?:\/\/(docs|drive)\.google\.com\//i.test(uri)) return 'CLOUD_DOC';
  return 'URL';
}

export function makeResource(
  ownerKind: ResourceOwnerKind,
  ownerId: string,
  patch: Partial<Resource> = {},
): Resource {
  return {
    id: nextId(),
    ownerKind,
    ownerId,
    kind: 'URL',
    label: 'Brief',
    uri: 'https://example.org/brief',
    machineLabel: null,
    checkStatus: 'UNCHECKED',
    lastCheckedAt: null,
    addedBy: 'Test Professor',
    addedAt: '2026-10-08T06:00:00.000Z',
    version: 1,
    ...patch,
  };
}

export function installResourcesApi(
  options: { readonly resources?: Resource[]; readonly canEdit?: boolean } = {},
): ResourcesApi {
  const delegate = globalThis.fetch;
  const resources = new Map((options.resources ?? []).map((r) => [r.id, r]));
  const calls: ResourcesApi['calls'] = [];

  const listFor = (competitionId: string): ResourceList => {
    const groups = new Map<string, ResourceList['groups'][number]>();
    for (const resource of resources.values()) {
      const key = `${resource.ownerKind}:${resource.ownerId}`;
      const group = groups.get(key) ?? {
        ownerKind: resource.ownerKind,
        ownerId: resource.ownerId,
        ownerLabel: resource.ownerKind === 'ENGAGEMENT' ? 'Competition' : resource.ownerKind,
        resources: [],
      };
      groups.set(key, { ...group, resources: [...group.resources, resource] });
    }
    return { competitionId, groups: [...groups.values()], canEdit: options.canEdit ?? true };
  };

  const route = (method: string, path: string, body: Record<string, unknown>) => {
    const list = /^\/api\/v1\/competitions\/([^/]+)\/resources$/.exec(path);
    if (list !== null && method === 'GET') return respond(200, listFor(list[1] ?? ''));
    if (path === '/api/v1/resources/check-results') {
      const results = body.results as {
        id: string;
        status: Resource['checkStatus'];
        checkedAt: string;
      }[];
      let updated = 0;
      for (const result of results) {
        const row = resources.get(result.id);
        if (row?.kind !== 'LOCAL_PATH') continue;
        resources.set(row.id, {
          ...row,
          checkStatus: result.status,
          lastCheckedAt: result.checkedAt,
        });
        updated += 1;
      }
      return respond(200, { updated });
    }
    if (path === '/api/v1/resources' && method === 'POST') {
      const uri = String(body.uri);
      const kind = (body.kind as ResourceKind | undefined) ?? detectKind(uri);
      if (kind === undefined) {
        return problem(
          422,
          'RESOURCE_INVALID_URI',
          'Only web links (http or https) and paths on a PC can be added.',
        );
      }
      const made = makeResource(body.ownerKind as ResourceOwnerKind, String(body.ownerId), {
        kind,
        uri,
        label:
          (body.label as string | undefined) ?? uri.split(/[\\/]/).filter(Boolean).at(-1) ?? uri,
        machineLabel:
          kind === 'LOCAL_PATH' ? ((body.machineLabel as string | undefined) ?? null) : null,
      });
      resources.set(made.id, made);
      return respond(200, made);
    }
    const one = /^\/api\/v1\/resources\/([^/]+)$/.exec(path);
    if (one === null) return undefined;
    const current = resources.get(one[1] ?? '');
    if (current === undefined)
      return problem(404, 'RESOURCE_NOT_FOUND', 'That resource does not exist.');
    if (body.version !== current.version) {
      return problem(
        409,
        'RESOURCE_VERSION_CONFLICT',
        'Someone else changed this — reload to see their change.',
      );
    }
    if (method === 'DELETE') {
      resources.delete(current.id);
      return respond(204, undefined);
    }
    const { version: _v, ...fields } = body;
    const next = { ...current, ...fields, version: current.version + 1 };
    resources.set(current.id, next);
    return respond(200, next);
  };

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = new URL(url).pathname;
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const answer = route(method, path, body);
      if (answer === undefined) return delegate(url, init);
      calls.push({ method, path, body: init.body === undefined ? undefined : body });
      return Promise.resolve(answer);
    }),
  );
  return { resources, calls };
}
