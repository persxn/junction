import type { DueRule, EventType } from '@compintel/contracts';

import { SEED_TEMPLATES, seedStageId } from '../../domain/workflows/seed-templates.js';
import type { EventDates } from '../../domain/workflows/due.js';
import type { DatabaseHandle } from '../../platform/db.js';

/**
 * Every SQL statement about workflow templates (WP-20a; SQL only in
 * repositories), the seeding of the five department defaults (R101), and the
 * event dates a due rule resolves against (R100).
 */

export interface TemplateRecord {
  readonly id: string;
  readonly departmentId: string;
  readonly name: string;
  readonly description: string | null;
  readonly appliesToEventType: EventType | null;
  readonly isDefaultForType: number;
  readonly versionNo: number;
  readonly isArchived: number;
  readonly createdBy: string | null;
  readonly ownerName: string | null;
  readonly stageCount: number;
}

export interface TemplateStageRecord {
  readonly id: string;
  readonly templateId: string;
  readonly position: number;
  readonly name: string;
  readonly description: string | null;
  readonly weight: number;
  readonly dueRuleJson: string | null;
  readonly defaultTasksJson: string;
}

const TEMPLATE_COLUMNS = `t.id, t.department_id AS departmentId, t.name, t.description,
  t.applies_to_event_type AS appliesToEventType, t.is_default_for_type AS isDefaultForType,
  t.version_no AS versionNo, t.is_archived AS isArchived, t.created_by AS createdBy,
  u.display_name AS ownerName,
  (SELECT count(*) FROM workflow_template_stages s WHERE s.template_id = t.id) AS stageCount`;

export const parseRule = (json: string | null): DueRule | null =>
  json === null ? null : (JSON.parse(json) as DueRule);
export const parseTasks = (json: string): string[] => JSON.parse(json) as string[];

export class TemplatesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  managingDepartmentId(): string | undefined {
    const row = this.#db.raw
      .prepare('SELECT id FROM departments ORDER BY is_managing DESC, created_at LIMIT 1')
      .get() as { id: string } | undefined;
    return row?.id;
  }

  /**
   * R101: the five defaults, inserted if absent — at setup completion and at
   * every startup. Returns how many were added. No department, nothing to do.
   */
  ensureSeeded(at: number): number {
    const departmentId = this.managingDepartmentId();
    if (departmentId === undefined) return 0;
    const exists = this.#db.raw.prepare('SELECT 1 FROM workflow_templates WHERE id = ?');
    const insertTemplate = this.#db.raw.prepare(
      `INSERT INTO workflow_templates (id, department_id, name, description, applies_to_event_type,
         is_default_for_type, version_no, is_archived, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, 0, NULL, ?, ?)`,
    );
    let added = 0;
    this.#db.raw.transaction(() => {
      SEED_TEMPLATES.forEach((template, index) => {
        if (exists.get(template.id) !== undefined) return;
        insertTemplate.run(
          template.id,
          departmentId,
          template.name,
          template.description,
          template.eventType,
          at,
          at,
        );
        template.stages.forEach((stage, position) => {
          this.insertStage({
            id: seedStageId(index + 1, position + 1),
            templateId: template.id,
            position: (position + 1) * 1024,
            name: stage.name,
            description: null,
            weight: stage.weight,
            dueRule: stage.rule,
            defaultTasks: stage.tasks,
          });
        });
        added += 1;
      });
    })();
    return added;
  }

  list(): TemplateRecord[] {
    return this.#db.raw
      .prepare(
        `SELECT ${TEMPLATE_COLUMNS} FROM workflow_templates t LEFT JOIN users u ON u.id = t.created_by
         ORDER BY t.is_archived, t.created_by IS NOT NULL, lower(t.name), t.id`,
      )
      .all() as TemplateRecord[];
  }

  find(id: string): TemplateRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${TEMPLATE_COLUMNS} FROM workflow_templates t LEFT JOIN users u ON u.id = t.created_by
         WHERE t.id = ?`,
      )
      .get(id) as TemplateRecord | undefined;
  }

  /** The preselected template for an event type (R101's defaults, or an admin's choice). */
  defaultFor(eventType: EventType): TemplateRecord | undefined {
    return this.#db.raw
      .prepare(
        `SELECT ${TEMPLATE_COLUMNS} FROM workflow_templates t LEFT JOIN users u ON u.id = t.created_by
         WHERE t.applies_to_event_type = ? AND t.is_default_for_type = 1 AND t.is_archived = 0`,
      )
      .get(eventType) as TemplateRecord | undefined;
  }

  stages(templateId: string): TemplateStageRecord[] {
    return this.#db.raw
      .prepare(
        `SELECT id, template_id AS templateId, position, name, description, weight,
           due_rule_json AS dueRuleJson, default_tasks_json AS defaultTasksJson
         FROM workflow_template_stages WHERE template_id = ? ORDER BY position, id`,
      )
      .all(templateId) as TemplateStageRecord[];
  }

  insertTemplate(row: {
    id: string;
    departmentId: string;
    name: string;
    description: string | null;
    appliesToEventType: EventType | null;
    createdBy: string;
    at: number;
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO workflow_templates (id, department_id, name, description, applies_to_event_type,
           is_default_for_type, version_no, is_archived, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, 0, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.departmentId,
        row.name,
        row.description,
        row.appliesToEventType,
        row.createdBy,
        row.at,
        row.at,
      );
  }

  insertStage(row: {
    id: string;
    templateId: string;
    position: number;
    name: string;
    description: string | null;
    weight: number;
    dueRule: DueRule | null;
    defaultTasks: readonly string[];
  }): void {
    this.#db.raw
      .prepare(
        `INSERT INTO workflow_template_stages (id, template_id, position, name, description, weight,
           due_rule_json, default_tasks_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.templateId,
        row.position,
        row.name,
        row.description,
        row.weight,
        row.dueRule === null ? null : JSON.stringify(row.dueRule),
        JSON.stringify(row.defaultTasks),
      );
  }

  /** Every edit bumps `version_no` (R101); the given columns change with it. */
  touch(
    id: string,
    at: number,
    change: Partial<{
      name: string;
      description: string | null;
      appliesToEventType: EventType | null;
      isDefaultForType: boolean;
      isArchived: boolean;
    }> = {},
  ): void {
    const sets = ['version_no = version_no + 1', 'updated_at = ?'];
    const args: unknown[] = [at];
    const column: Record<string, string> = {
      name: 'name',
      description: 'description',
      appliesToEventType: 'applies_to_event_type',
      isDefaultForType: 'is_default_for_type',
      isArchived: 'is_archived',
    };
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) continue;
      sets.push(`${column[key] ?? key} = ?`);
      args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
    this.#db.raw
      .prepare(`UPDATE workflow_templates SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, id);
  }

  /** An admin's new default for a type replaces the old one (one per type). */
  clearDefault(departmentId: string, eventType: EventType, at: number): void {
    this.#db.raw
      .prepare(
        `UPDATE workflow_templates SET is_default_for_type = 0, version_no = version_no + 1, updated_at = ?
         WHERE department_id = ? AND applies_to_event_type = ? AND is_default_for_type = 1`,
      )
      .run(at, departmentId, eventType);
  }

  updateStage(
    id: string,
    change: Partial<{
      name: string;
      description: string | null;
      weight: number;
      dueRule: DueRule | null;
      defaultTasks: readonly string[];
      position: number;
    }>,
  ): void {
    const sets: string[] = [];
    const args: unknown[] = [];
    const put = (column: string, value: unknown): void => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (change.name !== undefined) put('name', change.name);
    if (change.description !== undefined) put('description', change.description);
    if (change.weight !== undefined) put('weight', change.weight);
    if (change.dueRule !== undefined)
      put('due_rule_json', change.dueRule === null ? null : JSON.stringify(change.dueRule));
    if (change.defaultTasks !== undefined)
      put('default_tasks_json', JSON.stringify(change.defaultTasks));
    if (change.position !== undefined) put('position', change.position);
    if (sets.length === 0) return;
    this.#db.raw
      .prepare(`UPDATE workflow_template_stages SET ${sets.join(', ')} WHERE id = ?`)
      .run(...args, id);
  }

  deleteStage(id: string): void {
    this.#db.raw.prepare('DELETE FROM workflow_template_stages WHERE id = ?').run(id);
  }

  /** R100's anchors for one event, or undefined when it does not exist. */
  eventDates(eventId: string): (EventDates & { eventType: EventType }) | undefined {
    const event = this.#db.raw
      .prepare(
        `SELECT event_type AS eventType, registration_deadline_at AS reg,
           registration_deadline_precision AS regPrecision, submission_deadline_at AS sub,
           starts_at AS start, ends_at AS end, date_precision AS precision
         FROM events WHERE id = ?`,
      )
      .get(eventId) as
      | {
          eventType: EventType;
          reg: number | null;
          regPrecision: EventDates['deadlines'][number]['precision'];
          sub: number | null;
          start: number | null;
          end: number | null;
          precision: EventDates['deadlines'][number]['precision'];
        }
      | undefined;
    if (event === undefined) return undefined;
    const deadlines = this.#db.raw
      .prepare('SELECT kind, due_at AS at, precision FROM event_deadlines WHERE event_id = ?')
      .all(eventId) as EventDates['deadlines'][number][];
    const dated = (at: number | null, precision: EventDates['deadlines'][number]['precision']) =>
      at === null ? null : { at, precision };
    return {
      eventType: event.eventType,
      registrationDeadline: dated(event.reg, event.regPrecision),
      // The events table has one precision for the start/end/submission dates.
      submissionDeadline: dated(event.sub, event.precision),
      start: dated(event.start, event.precision),
      end: dated(event.end, event.precision),
      deadlines,
    };
  }
}
