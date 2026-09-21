import {
  CATEGORY_RULE_PREVIEW_MAX,
  type Category,
  type CategoryCreate,
  type CategoryPatch,
  type CategoryRule,
  type CategoryRuleCreate,
  type CategoryRulePatch,
  type CategoryRulePreview,
  type CategoryRulePreviewRequest,
  type CategoryRuleKind,
} from '@compintel/contracts';

import type { CategoryRow, CategoryRuleRow } from '../../db/schema/index.js';
import { withAudit, type AuditEntry, type AuditLog } from '../../platform/audit.js';
import { conflict, notFound, validationFailed } from '../../platform/errors.js';
import { uuid7 } from '../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { matchRule, prepareEvent, prepareRules, validateRulePattern } from './domain/classify.js';
import { categoryInUse, invalidRule, unsafeRulePattern } from './errors.js';
import { toRule, type CategoriesRepository } from './repo.js';
import type { CategoryClassifier } from './service.js';

/**
 * The admin API behind §10.2's "categories & rules" row: administrators only
 * (`category.manage`), every write audited, every rule change followed by a
 * batched re-classification. A rule can be previewed before it is saved —
 * the first 20 visible events it would match, with nothing written.
 */

export interface CategoryAdminContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export interface CategoryAdminDependencies {
  readonly repo: CategoriesRepository;
  readonly classifier: CategoryClassifier;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}

type EntryBody = Omit<AuditEntry, 'actorKind' | 'actorUserId' | 'requestId'>;

export class CategoryAdminService {
  readonly #deps: CategoryAdminDependencies;
  readonly #clock: Clock;

  constructor(deps: CategoryAdminDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  #audited<T>(context: CategoryAdminContext, entry: EntryBody, write: () => T): T {
    return withAudit(
      this.#deps.audit,
      {
        ...entry,
        actorKind: 'USER',
        actorUserId: context.actor.id,
        requestId: context.requestId ?? null,
      },
      write,
    );
  }

  list(context: CategoryAdminContext): Category[] {
    assertCan(context.actor, 'category.manage');
    return this.#deps.repo.list();
  }

  #category(id: string): CategoryRow {
    const row = this.#deps.repo.get(id);
    if (row === undefined) throw notFound(`There is no category ${id}.`);
    return row;
  }

  #checkParent(id: string | undefined, parentId: string | null | undefined): void {
    if (parentId === undefined || parentId === null) return;
    if (parentId === id || this.#deps.repo.get(parentId) === undefined) {
      throw validationFailed([
        { path: 'body.parentId', message: 'Not another existing category.' },
      ]);
    }
  }

  create(context: CategoryAdminContext, input: CategoryCreate): Category {
    assertCan(context.actor, 'category.manage');
    const clash = this.#deps.repo.clash(input.name, input.slug);
    if (clash !== undefined) throw conflict(`Another category already has the ${clash}.`);
    this.#checkParent(undefined, input.parentId);
    const at = nowMs(this.#clock);
    const row: CategoryRow = {
      id: uuid7(),
      name: input.name,
      slug: input.slug,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      colorToken: input.colorToken,
      icon: input.icon ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      createdBy: context.actor.id,
      createdAt: at,
      updatedAt: at,
    };
    this.#audited(
      context,
      {
        action: 'category.created',
        entityKind: 'category',
        entityId: row.id,
        summary: `Added the category "${row.name}"`,
        diff: { ...input },
      },
      () => {
        this.#deps.repo.insertCategory(row);
      },
    );
    return this.#view(row.id);
  }

  patch(context: CategoryAdminContext, id: string, input: CategoryPatch): Category {
    assertCan(context.actor, 'category.manage');
    const before = this.#category(id);
    const clash = this.#deps.repo.clash(input.name, input.slug, id);
    if (clash !== undefined) throw conflict(`Another category already has the ${clash}.`);
    this.#checkParent(id, input.parentId);
    const after: CategoryRow = {
      ...before,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      updatedAt: nowMs(this.#clock),
    };
    this.#audited(
      context,
      {
        action: 'category.updated',
        entityKind: 'category',
        entityId: id,
        summary: `Changed the category "${after.name}"`,
        diff: { changes: { ...input }, previous: { ...before } },
      },
      () => {
        this.#deps.repo.updateCategory(after);
      },
    );
    // Activating or deactivating a category changes which rules apply.
    if (input.isActive !== undefined && input.isActive !== before.isActive) {
      this.#deps.classifier.requestReclassification(
        `category ${before.slug} active=${String(input.isActive)}`,
        context.actor.id,
      );
    }
    return this.#view(id);
  }

  delete(context: CategoryAdminContext, id: string, reassign: string | undefined): void {
    assertCan(context.actor, 'category.manage');
    const category = this.#category(id);
    if (
      reassign !== undefined &&
      (reassign === id || this.#deps.repo.get(reassign) === undefined)
    ) {
      throw validationFailed([
        { path: 'query.reassign', message: 'Not another existing category.' },
      ]);
    }
    const usage = this.#deps.repo.usage(id);
    if (usage > 0 && reassign === undefined) throw categoryInUse(category.name, usage);
    this.#audited(
      context,
      {
        action: 'category.deleted',
        entityKind: 'category',
        entityId: id,
        summary: `Removed the category "${category.name}"${reassign === undefined ? '' : ', reassigning its events'}`,
        diff: { previous: { ...category }, assignments: usage, reassignedTo: reassign ?? null },
      },
      () => {
        this.#deps.repo.deleteCategory(id, reassign);
      },
    );
    this.#deps.classifier.requestReclassification(
      `category ${category.slug} deleted`,
      context.actor.id,
    );
  }

  #view(id: string): Category {
    const found = this.#deps.repo.list().find((category) => category.id === id);
    if (found === undefined) throw notFound(`There is no category ${id}.`);
    return found;
  }

  // ---- Rules --------------------------------------------------------------------

  listRules(context: CategoryAdminContext, categoryId?: string): CategoryRule[] {
    assertCan(context.actor, 'category.manage');
    return this.#deps.repo.rules(categoryId);
  }

  #validate(kind: CategoryRuleKind, pattern: string): void {
    const problem = validateRulePattern(kind, pattern);
    if (problem === undefined) return;
    throw problem.unsafe ? unsafeRulePattern(problem.message) : invalidRule(problem.message);
  }

  createRule(context: CategoryAdminContext, input: CategoryRuleCreate): CategoryRule {
    assertCan(context.actor, 'category.manage');
    const category = this.#category(input.categoryId);
    this.#validate(input.kind, input.pattern);
    const at = nowMs(this.#clock);
    const row: CategoryRuleRow = {
      id: uuid7(),
      categoryId: input.categoryId,
      kind: input.kind,
      pattern: input.pattern,
      fields: input.fields,
      weight: input.weight,
      isActive: input.isActive ?? true,
      createdAt: at,
      updatedAt: at,
    };
    this.#audited(
      context,
      {
        action: 'category.rule.created',
        entityKind: 'category_rule',
        entityId: row.id,
        summary: `Added a ${row.kind} rule "${row.pattern}" to "${category.name}"`,
        diff: toRule(row),
      },
      () => {
        this.#deps.repo.insertRule(row);
      },
    );
    this.#deps.classifier.requestReclassification(`rule ${row.id} created`, context.actor.id);
    return toRule(row);
  }

  patchRule(context: CategoryAdminContext, id: string, input: CategoryRulePatch): CategoryRule {
    assertCan(context.actor, 'category.manage');
    const before = this.#deps.repo.rule(id);
    if (before === undefined) throw notFound(`There is no category rule ${id}.`);
    if (input.categoryId !== undefined) this.#category(input.categoryId);
    const after: CategoryRuleRow = {
      ...before,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      updatedAt: nowMs(this.#clock),
    };
    this.#validate(after.kind, after.pattern);
    this.#audited(
      context,
      {
        action: 'category.rule.updated',
        entityKind: 'category_rule',
        entityId: id,
        summary: `Changed the ${after.kind} rule "${after.pattern}"`,
        diff: { changes: { ...input }, previous: toRule(before) },
      },
      () => {
        this.#deps.repo.updateRule(after);
      },
    );
    this.#deps.classifier.requestReclassification(`rule ${id} updated`, context.actor.id);
    return toRule(after);
  }

  deleteRule(context: CategoryAdminContext, id: string): void {
    assertCan(context.actor, 'category.manage');
    const before = this.#deps.repo.rule(id);
    if (before === undefined) throw notFound(`There is no category rule ${id}.`);
    this.#audited(
      context,
      {
        action: 'category.rule.deleted',
        entityKind: 'category_rule',
        entityId: id,
        summary: `Removed the ${before.kind} rule "${before.pattern}"`,
        diff: { previous: toRule(before) },
      },
      () => {
        this.#deps.repo.deleteRule(id);
      },
    );
    this.#deps.classifier.requestReclassification(`rule ${id} deleted`, context.actor.id);
  }

  /** The first {@link CATEGORY_RULE_PREVIEW_MAX} visible events a candidate rule matches. Reads only. */
  preview(context: CategoryAdminContext, input: CategoryRulePreviewRequest): CategoryRulePreview {
    assertCan(context.actor, 'category.manage');
    this.#validate(input.kind, input.pattern);
    const [rule] = prepareRules([{ id: 'preview', categoryId: 'preview', weight: 100, ...input }]);
    if (rule === undefined) throw invalidRule('The rule could not be prepared.');
    const items: CategoryRulePreview['items'] = [];
    let scanned = 0;
    for (const event of this.#deps.repo.visibleInputs()) {
      scanned += 1;
      const matchedIn = matchRule(rule, prepareEvent(event, event.sourceTags));
      if (matchedIn !== undefined) items.push({ id: event.id, title: event.title, matchedIn });
      if (items.length >= CATEGORY_RULE_PREVIEW_MAX) break;
    }
    return { items, scanned };
  }
}
