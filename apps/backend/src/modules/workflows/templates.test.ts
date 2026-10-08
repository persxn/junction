import type { WorkflowTemplateDetail, WorkflowTemplateList } from '@compintel/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEED_TEMPLATES } from '../../domain/workflows/seed-templates.js';
import { openMigratedDatabase } from '../../testing/database.js';
import type { TestServer } from '../../testing/harness.js';
import { silentLogger } from '../../testing/scraping.js';
import {
  call,
  openStudentsHarness,
  startStudentsServer,
  type StudentsHarness,
} from '../../testing/students.js';
import { TemplatesRepository } from './templates-repo.js';

/**
 * Workflow templates (WP-20a steps 4–5, §10.2, R101): the five seeded
 * defaults, who may edit what, `versionNo` as the concurrency version, and
 * stage edits — over HTTP.
 */

let h: StudentsHarness;
let server: TestServer;
beforeAll(async () => {
  h = openStudentsHarness();
  server = await startStudentsServer(h);
});
afterAll(async () => {
  await server.close();
  h.close();
});

const HACKATHON = SEED_TEMPLATES[0]!.id;
const get = async (id: string): Promise<WorkflowTemplateDetail> =>
  (await call(server, 'GET', `/api/v1/workflow-templates/${id}`, { as: h.alice }))
    .body as unknown as WorkflowTemplateDetail;

describe('the seeded defaults (R101)', () => {
  it('are the five department defaults, each preselected for its type, OTHER without one', async () => {
    const list = (await call(server, 'GET', '/api/v1/workflow-templates', { as: h.alice }))
      .body as unknown as WorkflowTemplateList;
    const defaults = list.items.filter((item) => item.isDepartmentDefault);
    expect(
      defaults.map((item) => [item.name, item.appliesToEventType, item.isDefaultForType]),
    ).toEqual([
      ['Coding contest', 'CODING_CONTEST', true],
      ['CTF', 'CTF', true],
      ['Hackathon', 'HACKATHON', true],
      ['Ideathon', 'IDEATHON', true],
      ['Innovation challenge', 'INNOVATION_CHALLENGE', true],
    ]);
    const hackathon = await get(HACKATHON);
    expect(hackathon.stages.map((stage) => [stage.name, stage.weight])).toEqual([
      ['Team & registration', 1],
      ['Idea & problem', 2],
      ['Build prototype', 4],
      ['Submit & demo', 2],
      ['Wrap-up', 1],
    ]);
    expect(hackathon.stages[0]?.dueRule).toEqual({
      anchor: 'REGISTRATION_DEADLINE',
      offsetDays: -2,
    });
    expect(hackathon.stages.every((stage) => stage.defaultTasks.length >= 2)).toBe(true);
  });

  it('seeding again adds nothing; with no department it waits', () => {
    expect(h.workflows.templatesRepository.ensureSeeded(Date.now())).toBe(0);
    const bare = openMigratedDatabase(silentLogger, 'templates-bare');
    try {
      expect(new TemplatesRepository(bare.db).ensureSeeded(Date.now())).toBe(0);
    } finally {
      bare.close();
    }
  });
});

describe('who may edit what (§10.2)', () => {
  it('a professor editing a default gets WORKFLOW_TEMPLATE_READ_ONLY; an admin may', async () => {
    const before = await get(HACKATHON);
    expect(before.canEdit).toBe(false);
    const refused = await call(server, 'PATCH', `/api/v1/workflow-templates/${HACKATHON}`, {
      as: h.alice,
      body: { name: 'Mine now', versionNo: before.versionNo },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('WORKFLOW_TEMPLATE_READ_ONLY');
    const admin = await call(server, 'PATCH', `/api/v1/workflow-templates/${HACKATHON}`, {
      as: h.admin,
      body: { description: 'Edited by an admin', versionNo: before.versionNo },
    });
    expect(admin.status).toBe(200);
    expect((admin.body as unknown as WorkflowTemplateDetail).versionNo).toBe(before.versionNo + 1);
  });

  it('a clone is the cloner’s: version 1, editable by him, read-only to another professor', async () => {
    const clone = (
      await call(server, 'POST', `/api/v1/workflow-templates/${HACKATHON}/clone`, {
        as: h.alice,
        body: {},
      })
    ).body as unknown as WorkflowTemplateDetail;
    expect(clone).toMatchObject({
      name: 'Hackathon (my copy)',
      versionNo: 1,
      ownedByMe: true,
      canEdit: true,
    });
    expect(clone.isDefaultForType).toBe(false);
    expect(clone.stages).toHaveLength(5);
    const bob = await call(server, 'PATCH', `/api/v1/workflow-templates/${clone.id}`, {
      as: h.bob,
      body: { name: 'Bob’s', versionNo: 1 },
    });
    expect(bob.body.code).toBe('WORKFLOW_TEMPLATE_READ_ONLY');
    // Only an admin picks the default for a type.
    const promote = await call(server, 'PATCH', `/api/v1/workflow-templates/${clone.id}`, {
      as: h.alice,
      body: { isDefaultForType: true, versionNo: 1 },
    });
    expect(promote.body.code).toBe('WORKFLOW_TEMPLATE_READ_ONLY');
  });

  it('an admin’s new default for a type replaces the old one', async () => {
    const clone = (
      await call(server, 'POST', `/api/v1/workflow-templates/${SEED_TEMPLATES[3]!.id}/clone`, {
        as: h.admin,
        body: { name: 'CTF, our way' },
      })
    ).body as unknown as WorkflowTemplateDetail;
    await call(server, 'PATCH', `/api/v1/workflow-templates/${clone.id}`, {
      as: h.admin,
      body: { isDefaultForType: true, versionNo: 1 },
    });
    expect((await get(clone.id)).isDefaultForType).toBe(true);
    expect((await get(SEED_TEMPLATES[3]!.id)).isDefaultForType).toBe(false);
  });
});

describe('editing stages', () => {
  it('add, move, edit and remove each bump the version; a stale one is refused', async () => {
    let t = (
      await call(server, 'POST', `/api/v1/workflow-templates/${HACKATHON}/clone`, {
        as: h.bob,
        body: { name: 'Bob’s hackathon' },
      })
    ).body as unknown as WorkflowTemplateDetail;
    const first = t.stages[0]!.id;
    const send = async (method: string, path: string, body: Record<string, unknown>) => {
      const response = await call(server, method, `/api/v1/workflow-templates/${t.id}${path}`, {
        as: h.bob,
        body: { ...body, versionNo: t.versionNo },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      t = response.body as unknown as WorkflowTemplateDetail;
    };
    await send('POST', '/stages', {
      name: 'Mentor check-in',
      weight: 1,
      dueRule: { anchor: 'EVENT_START', offsetDays: -1 },
      defaultTasks: ['Book a slot'],
      beforeId: first,
    });
    expect(t.stages[0]?.name).toBe('Mentor check-in');
    expect(t.versionNo).toBe(2);
    await send('POST', `/stages/${t.stages[0]!.id}/move`, { afterId: t.stages.at(-1)!.id });
    expect(t.stages.at(-1)?.name).toBe('Mentor check-in');
    await send('PATCH', `/stages/${first}`, { weight: 3 });
    expect(t.stages[0]?.weight).toBe(3);
    await send('POST', `/stages/${first}/remove`, {});
    expect(t.stages.map((stage) => stage.id)).not.toContain(first);
    expect(t.versionNo).toBe(5);

    const stale = await call(server, 'PATCH', `/api/v1/workflow-templates/${t.id}`, {
      as: h.bob,
      body: { name: 'Late', versionNo: 2 },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.detail).toBe('Someone else changed this — reload to see their change.');
    // Every edit is audited.
    const audited = h.database.db.raw
      .prepare(
        "SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND entity_kind = 'workflow_template'",
      )
      .get(t.id) as { n: number };
    expect(audited.n).toBe(5);
  });
});
