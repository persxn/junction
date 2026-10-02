import { z } from 'zod';

/**
 * The permission matrix (ARCHITECTURE.md §10.2), as data (ruling R32).
 *
 * This file is the single source of truth for "who may do what". The backend's
 * `policy.can()` reads it and the UI's control-hiding reads it, so the two can
 * never disagree — and §10.1 is explicit that the UI's copy is cosmetic: hiding a
 * button is a courtesy, `assertCan` in the service is the security.
 *
 * Three things make the matrix testable rather than merely written down:
 *   - `ACTIONS` is a closed list, so a capability either has a name or does not
 *     exist;
 *   - `ROLE_ACTIONS` is **total** — every role names every action, with `NEVER`
 *     where it is not allowed — so adding an action without deciding what each
 *     role may do with it is a type error, not a silent allow;
 *   - ownership is a named rule, not a lambda, so §10.2's "primary mentor" and
 *     "an active mentor via mentorships" are decided in one place and the facts
 *     behind them are supplied by whoever knows the resource.
 */

/** `roles.key` (§6.2 Identity & access). A user may hold both (R32). */
export const ROLE_KEYS = ['ADMINISTRATOR', 'PROFESSOR'] as const;
export const RoleKey = z.enum(ROLE_KEYS);
export type RoleKey = z.infer<typeof RoleKey>;

/**
 * Every capability in §10.2, named. The dotted form is `<entity>.<verb>`; it is
 * also what the audit log records, so the two vocabularies stay one vocabulary.
 */
export const ACTIONS = [
  // Reading. The department model is open (§10.2), so viewing is not owned.
  'event.view',
  'student.view',
  'team.view',
  'competition.view',
  'activity.view',

  // Events
  'event.save',
  'event.hide',
  'event.categorize',
  'event.create_manual',
  'event.import_url',
  'event.correct',
  'event.mark_cancelled',
  'event.merge_duplicates',

  // Students
  'student.create',
  'student.edit',
  'student.deactivate',
  'student.erase',
  'student.import',
  /** R91: a professor starts and ends only their own mentorships; an admin anyone's. */
  'mentorship.manage',

  // Teams
  'team.create',
  'team.edit',
  'team.archive',
  'team.manage_mentors',
  'team.transfer_ownership',
  /** R95: hand the team's PRIMARY role to another professor, from inside the team. */
  'team.transfer_primary',

  // Competitions, workflows and saved searches
  'competition.edit',
  'workflow_template.manage_own',
  'workflow_template.manage_all',
  'saved_search.manage',

  // Administration
  'user.manage',
  'category.manage',
  'source.manage',
  'campus.manage',
  'settings.manage',
  'duplicate.review',

  // Backup, export and the audit log
  'backup.run',
  'backup.restore',
  'export.all',
  'audit.view_all',
  'system.health.view',
] as const;
export const Action = z.enum(ACTIONS);
export type Action = z.infer<typeof Action>;

/**
 * How an allowed action is narrowed by the actor's relationship to the resource.
 *
 * `ALWAYS` needs no resource; the rest do, and asking without one is a denial
 * rather than an allow — a caller that forgot to load the resource must not get
 * the benefit of the doubt.
 */
export const OWNERSHIP_RULES = [
  /** Allowed outright. */
  'ALWAYS',
  /** Never allowed for this role. */
  'NEVER',
  /** Only rows the actor created or owns (saved searches, hidden events). */
  'OWN',
  /** Primary mentor or co-mentor of the team (§10.2 "Edit a team"). */
  'TEAM_MENTOR',
  /** Primary mentor only (§10.2 "Archive team, add/remove mentors"). */
  'TEAM_PRIMARY_MENTOR',
  /**
   * §10.2's deactivate rule: an active mentor of the student via `mentorships`,
   * or the primary/co-mentor of an active team the student belongs to.
   */
  'STUDENT_MENTOR',
] as const;
export const OwnershipRule = z.enum(OWNERSHIP_RULES);
export type OwnershipRule = z.infer<typeof OwnershipRule>;

/** What the caller knows about the actor's relationship to the resource. */
export interface OwnershipFacts {
  /** The actor created or owns this row. */
  readonly isOwner?: boolean;
  /** The actor is the primary mentor or a co-mentor of the team. */
  readonly isTeamMentor?: boolean;
  readonly isTeamPrimaryMentor?: boolean;
  /** The actor mentors this student, directly or through an active team. */
  readonly isStudentMentor?: boolean;
}

type Matrix = Readonly<Record<RoleKey, Readonly<Record<Action, OwnershipRule>>>>;

/**
 * §10.2, transcribed. `NEVER` rows are as deliberate as the allowed ones: they
 * are how "—" in the matrix survives a refactor.
 */
export const ROLE_ACTIONS: Matrix = {
  ADMINISTRATOR: {
    'event.view': 'ALWAYS',
    'student.view': 'ALWAYS',
    'team.view': 'ALWAYS',
    'competition.view': 'ALWAYS',
    'activity.view': 'ALWAYS',

    'event.save': 'OWN',
    'event.hide': 'OWN',
    'event.categorize': 'ALWAYS',
    'event.create_manual': 'ALWAYS',
    'event.import_url': 'ALWAYS',
    'event.correct': 'ALWAYS',
    'event.mark_cancelled': 'ALWAYS',
    'event.merge_duplicates': 'ALWAYS',

    'student.create': 'ALWAYS',
    'student.edit': 'ALWAYS',
    'student.deactivate': 'ALWAYS',
    'student.erase': 'ALWAYS',
    'student.import': 'ALWAYS',
    'mentorship.manage': 'ALWAYS',

    'team.create': 'ALWAYS',
    'team.edit': 'ALWAYS',
    'team.archive': 'ALWAYS',
    'team.manage_mentors': 'ALWAYS',
    'team.transfer_ownership': 'ALWAYS',
    'team.transfer_primary': 'ALWAYS',

    'competition.edit': 'ALWAYS',
    'workflow_template.manage_own': 'ALWAYS',
    'workflow_template.manage_all': 'ALWAYS',
    'saved_search.manage': 'OWN',

    'user.manage': 'ALWAYS',
    'category.manage': 'ALWAYS',
    'source.manage': 'ALWAYS',
    'campus.manage': 'ALWAYS',
    'settings.manage': 'ALWAYS',
    'duplicate.review': 'ALWAYS',

    'backup.run': 'ALWAYS',
    'backup.restore': 'ALWAYS',
    'export.all': 'ALWAYS',
    'audit.view_all': 'ALWAYS',
    'system.health.view': 'ALWAYS',
  },
  PROFESSOR: {
    'event.view': 'ALWAYS',
    'student.view': 'ALWAYS',
    'team.view': 'ALWAYS',
    'competition.view': 'ALWAYS',
    // "Activity timeline of a record — ✓ (records they can view)"; the view
    // check on the record itself is the gate, so this one is open.
    'activity.view': 'ALWAYS',

    'event.save': 'OWN',
    'event.hide': 'OWN',
    'event.categorize': 'ALWAYS',
    'event.create_manual': 'ALWAYS',
    'event.import_url': 'ALWAYS',
    'event.correct': 'NEVER',
    'event.mark_cancelled': 'NEVER',
    'event.merge_duplicates': 'NEVER',

    'student.create': 'ALWAYS',
    'student.edit': 'ALWAYS',
    'student.deactivate': 'STUDENT_MENTOR',
    'student.erase': 'NEVER',
    'student.import': 'ALWAYS',
    'mentorship.manage': 'OWN',

    'team.create': 'ALWAYS',
    'team.edit': 'TEAM_MENTOR',
    'team.archive': 'TEAM_PRIMARY_MENTOR',
    'team.manage_mentors': 'TEAM_PRIMARY_MENTOR',
    'team.transfer_ownership': 'NEVER',
    'team.transfer_primary': 'TEAM_PRIMARY_MENTOR',

    'competition.edit': 'TEAM_MENTOR',
    'workflow_template.manage_own': 'OWN',
    'workflow_template.manage_all': 'NEVER',
    'saved_search.manage': 'OWN',

    'user.manage': 'NEVER',
    'category.manage': 'NEVER',
    'source.manage': 'NEVER',
    'campus.manage': 'NEVER',
    'settings.manage': 'NEVER',
    'duplicate.review': 'NEVER',

    'backup.run': 'ALWAYS',
    'backup.restore': 'NEVER',
    'export.all': 'NEVER',
    'audit.view_all': 'NEVER',
    'system.health.view': 'NEVER',
  },
};

/** The rule one role has for one action. */
export function ruleFor(role: RoleKey, action: Action): OwnershipRule {
  return ROLE_ACTIONS[role][action];
}

/**
 * The strongest rule the actor's roles give for an action. A user holding both
 * roles gets the union of their permissions, so ADMINISTRATOR's `ALWAYS` beats
 * PROFESSOR's `TEAM_MENTOR` rather than the other way round (R32).
 */
const RULE_STRENGTH: Readonly<Record<OwnershipRule, number>> = {
  NEVER: 0,
  OWN: 1,
  STUDENT_MENTOR: 1,
  TEAM_PRIMARY_MENTOR: 1,
  TEAM_MENTOR: 2,
  ALWAYS: 3,
};

export function effectiveRule(roles: readonly RoleKey[], action: Action): OwnershipRule {
  let strongest: OwnershipRule = 'NEVER';
  for (const role of roles) {
    const rule = ruleFor(role, action);
    if (RULE_STRENGTH[rule] > RULE_STRENGTH[strongest]) {
      strongest = rule;
    }
  }
  return strongest;
}

/** Whether a rule is satisfied by what the caller knows about the resource. */
export function ruleSatisfied(rule: OwnershipRule, facts: OwnershipFacts | undefined): boolean {
  switch (rule) {
    case 'ALWAYS':
      return true;
    case 'NEVER':
      return false;
    // A missing fact is a denial: a caller that did not load the resource must
    // not be luckier than one that did and found the actor is not the owner.
    case 'OWN':
      return facts?.isOwner === true;
    case 'TEAM_MENTOR':
      return facts?.isTeamMentor === true || facts?.isTeamPrimaryMentor === true;
    case 'TEAM_PRIMARY_MENTOR':
      return facts?.isTeamPrimaryMentor === true;
    case 'STUDENT_MENTOR':
      return facts?.isStudentMentor === true;
  }
}

/**
 * The whole decision: does an actor with these roles may take this action on a
 * resource with these facts? This is the shape `policy.can()` wraps, and the
 * only place the answer is computed.
 */
export function decide(roles: readonly RoleKey[], action: Action, facts?: OwnershipFacts): boolean {
  return ruleSatisfied(effectiveRule(roles, action), facts);
}

/**
 * What `GET /me/permissions` returns: every action the roles could take, with
 * the rule that still has to be satisfied per resource. The UI uses `ALWAYS` to
 * show a control outright and the others to show it and let the server decide.
 */
export function permissionsFor(
  roles: readonly RoleKey[],
): readonly { readonly action: Action; readonly rule: OwnershipRule }[] {
  return ACTIONS.map((action) => ({ action, rule: effectiveRule(roles, action) })).filter(
    (entry) => entry.rule !== 'NEVER',
  );
}

/** Just the part of a user the ownership predicates read. */
export interface PredicateSubject {
  readonly id: string;
}

/**
 * R91's mentorship rule: a professor's own mentorship is the one whose mentor
 * is that professor. Feeds `OwnershipFacts.isOwner` for `mentorship.manage`.
 */
export function isSelf(user: PredicateSubject, userId: string): boolean {
  return user.id === userId;
}

/**
 * §10.2's deactivate rule, as the facts that decide it: the user is an active
 * mentor of the student (`mentorUserIds`), or the primary or co-mentor of an
 * active team the student belongs to (`teamMentorUserIds` — empty until WP-18
 * gives teams their mentors). Feeds `OwnershipFacts.isStudentMentor`.
 */
export function canDeactivateStudent(
  user: PredicateSubject,
  relation: {
    readonly mentorUserIds: readonly string[];
    readonly teamMentorUserIds: readonly string[];
  },
): boolean {
  return relation.mentorUserIds.includes(user.id) || relation.teamMentorUserIds.includes(user.id);
}

/** A team's open mentor rows, as the team predicates read them. */
export interface TeamMentorship {
  readonly primaryUserId: string | null;
  readonly coMentorUserIds: readonly string[];
}

/** §10.2 "Edit a team": its primary mentor or a co-mentor. Feeds `isTeamMentor`. */
export function isTeamMentor(user: PredicateSubject, team: TeamMentorship): boolean {
  return team.primaryUserId === user.id || team.coMentorUserIds.includes(user.id);
}

/** §10.2 "Archive team, add/remove mentors" and R95's transfer: the primary only. */
export function isTeamPrimaryMentor(user: PredicateSubject, team: TeamMentorship): boolean {
  return team.primaryUserId === user.id;
}
