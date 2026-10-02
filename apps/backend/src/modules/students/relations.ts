import {
  isSelf,
  type StartMentorshipRequest,
  type StudentAchievementInput,
  type StudentDetail,
  type StudentTagsRequest,
  type TagSuggestionQuery,
  type TagSuggestions,
} from '@compintel/contracts';

import { studentRef } from '../../domain/students/records.js';
import { withAudit } from '../../platform/audit.js';
import { notFound, validationFailed } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { normalizeTag } from '../categories/domain/text.js';
import { assertCan } from '../auth/policy.js';
import { alreadyMentored, mentorshipNotFound, studentVersionConflict } from './errors.js';
import type { StudentsContext, StudentsDependencies } from './mappers.js';
import { StudentReader } from './reader.js';
import type { AchievementFields } from './relations-repo.js';

/**
 * Skills and interests, mentorships and achievements (§6.2, R91).
 *
 * Tags are set as the whole intended set with the student's `version` (WP-16b's
 * pattern): a no-op writes nothing and no audit row. Mentorships follow R91: a
 * professor starts and ends his own, an administrator anyone's, and ending sets
 * `ended_at` rather than deleting.
 */

const UNIQUE = (error: unknown): boolean =>
  error instanceof Error && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';

/** Trimmed, or null when nothing is left. */
const clean = (text: string | null | undefined): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const achievementFields = (input: StudentAchievementInput): AchievementFields => ({
  title: input.title.trim(),
  eventName: clean(input.eventName),
  year: input.year ?? null,
  result: clean(input.result),
  url: input.url ?? null,
  notes: clean(input.notes),
});

export class StudentRelationsService {
  readonly #deps: StudentsDependencies;
  readonly #clock: Clock;
  readonly #reader: StudentReader;

  constructor(deps: StudentsDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#reader = new StudentReader(deps);
  }

  suggestTags(context: StudentsContext, query: TagSuggestionQuery): TagSuggestions {
    assertCan(context.actor, 'student.view');
    // A skill may borrow an event's TECHNOLOGY word; an interest a THEME (R87).
    const kinds =
      query.kind === 'SKILL'
        ? ['SKILL', 'TECHNOLOGY']
        : query.kind === 'INTEREST'
          ? ['INTEREST', 'THEME']
          : ['SKILL', 'INTEREST', 'TECHNOLOGY', 'THEME'];
    return { tags: this.#deps.relations.suggestTags(kinds, query.text) };
  }

  setTags(context: StudentsContext, id: string, request: StudentTagsRequest): StudentDetail {
    assertCan(context.actor, 'student.edit');
    const row = this.#reader.requireLive(id);
    if (row.version !== request.version) throw studentVersionConflict();

    // One entry per (normalized name, relation); the last one given wins.
    const wanted = new Map<string, StudentTagsRequest['tags'][number]>();
    for (const tag of request.tags) wanted.set(`${tag.relation}:${normalizeTag(tag.name)}`, tag);
    const current = this.#deps.relations.tagsByStudent([id])[0]?.[1] ?? [];
    const held = new Map(current.map((tag) => [`${tag.relation}:${tag.normalized}`, tag]));
    const added = [...wanted.keys()].filter((key) => !held.has(key));
    const removed = [...held.keys()].filter((key) => !wanted.has(key));
    const rated = [...wanted].filter(
      ([key, tag]) => held.has(key) && held.get(key)?.proficiency !== tag.proficiency,
    );
    if (added.length + removed.length + rated.length === 0) {
      return this.#reader.detail(context.actor, id);
    }

    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.tags.changed',
        entityKind: 'student',
        entityId: id,
        summary: `Changed the skills and interests of ${studentRef(id)}`,
        // Tag names are vocabulary, not personal data (R92 names what is).
        diff: { added, removed, rerated: rated.map(([key]) => key) },
        requestId: context.requestId ?? null,
      },
      () => {
        const tags = [...wanted.values()].map((tag) => ({
          tagId: this.#deps.relations.ensureTag(tag.relation, tag.name, at),
          relation: tag.relation,
          proficiency: tag.proficiency,
        }));
        if (!this.#deps.students.touch(id, request.version, at)) throw studentVersionConflict();
        this.#deps.relations.replaceTags(id, tags);
      },
    );
    return this.#reader.detail(context.actor, id);
  }

  startMentorship(
    context: StudentsContext,
    studentId: string,
    request: StartMentorshipRequest,
  ): StudentDetail {
    const mentorUserId = request.mentorUserId ?? context.actor.id;
    assertCan(context.actor, 'mentorship.manage', { isOwner: isSelf(context.actor, mentorUserId) });
    this.#reader.requireLive(studentId);
    if (!this.#deps.relations.isActiveUser(mentorUserId)) {
      throw validationFailed([
        { path: 'body.mentorUserId', message: 'That account does not exist or is disabled.' },
      ]);
    }
    if (this.#deps.relations.openMentorUserIds(studentId).includes(mentorUserId)) {
      throw alreadyMentored();
    }
    try {
      withAudit(
        this.#deps.audit,
        (mentorshipId: string) => ({
          actorKind: 'USER',
          actorUserId: context.actor.id,
          action: 'mentorship.started',
          entityKind: 'mentorship',
          entityId: mentorshipId,
          summary: `Started mentoring ${studentRef(studentId)}`,
          diff: { studentId, mentorUserId },
          requestId: context.requestId ?? null,
        }),
        () =>
          this.#deps.relations.startMentorship({
            mentorUserId,
            studentId,
            note: clean(request.note),
            createdBy: context.actor.id,
            at: nowMs(this.#clock),
          }),
      );
    } catch (error) {
      if (UNIQUE(error)) throw alreadyMentored();
      throw error;
    }
    return this.#reader.detail(context.actor, studentId);
  }

  endMentorship(context: StudentsContext, mentorshipId: string): StudentDetail {
    const mentorship = this.#deps.relations.mentorship(mentorshipId);
    if (mentorship?.endedAt !== null) throw mentorshipNotFound();
    // The student must still be this organization's; an erased one has no mentorships.
    this.#reader.require(mentorship.studentId);
    assertCan(context.actor, 'mentorship.manage', {
      isOwner: isSelf(context.actor, mentorship.mentorUserId),
    });
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'mentorship.ended',
        entityKind: 'mentorship',
        entityId: mentorshipId,
        summary: `Ended a mentorship of ${studentRef(mentorship.studentId)}`,
        diff: { studentId: mentorship.studentId, mentorUserId: mentorship.mentorUserId },
        requestId: context.requestId ?? null,
      },
      () => {
        if (!this.#deps.relations.endMentorship(mentorshipId, nowMs(this.#clock))) {
          throw mentorshipNotFound();
        }
      },
    );
    return this.#reader.detail(context.actor, mentorship.studentId);
  }

  addAchievement(
    context: StudentsContext,
    studentId: string,
    input: StudentAchievementInput,
  ): StudentDetail {
    assertCan(context.actor, 'student.edit');
    this.#reader.requireLive(studentId);
    withAudit(
      this.#deps.audit,
      (achievementId: string) => ({
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.achievement.added',
        entityKind: 'student',
        entityId: studentId,
        summary: `Added an achievement to ${studentRef(studentId)}`,
        diff: { achievementId },
        requestId: context.requestId ?? null,
      }),
      () =>
        this.#deps.relations.insertAchievement(
          studentId,
          achievementFields(input),
          context.actor.id,
          nowMs(this.#clock),
        ),
    );
    return this.#reader.detail(context.actor, studentId);
  }

  updateAchievement(
    context: StudentsContext,
    studentId: string,
    achievementId: string,
    input: StudentAchievementInput,
  ): StudentDetail {
    assertCan(context.actor, 'student.edit');
    this.#requireAchievement(studentId, achievementId);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.achievement.updated',
        entityKind: 'student',
        entityId: studentId,
        summary: `Edited an achievement of ${studentRef(studentId)}`,
        diff: { achievementId },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.relations.updateAchievement(achievementId, achievementFields(input));
      },
    );
    return this.#reader.detail(context.actor, studentId);
  }

  deleteAchievement(
    context: StudentsContext,
    studentId: string,
    achievementId: string,
  ): StudentDetail {
    assertCan(context.actor, 'student.edit');
    this.#requireAchievement(studentId, achievementId);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'student.achievement.deleted',
        entityKind: 'student',
        entityId: studentId,
        summary: `Removed an achievement from ${studentRef(studentId)}`,
        diff: { achievementId },
        requestId: context.requestId ?? null,
      },
      () => {
        this.#deps.relations.deleteAchievement(achievementId);
      },
    );
    return this.#reader.detail(context.actor, studentId);
  }

  #requireAchievement(studentId: string, achievementId: string): void {
    this.#reader.requireLive(studentId);
    if (this.#deps.relations.achievement(achievementId)?.studentId !== studentId) {
      throw notFound('That achievement does not belong to this student.');
    }
  }
}
