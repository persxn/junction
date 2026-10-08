/**
 * The ownership predicates (ruling R32): the facts `decide()` is given, worked
 * out from who the user is and what the resource says. Only here — never in a
 * service, never in a component — so "who mentors this" has one answer.
 */

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

/**
 * R96: a competition owns its mentors — the rows copied from the team at
 * assignment, edited on the competition afterwards. Feeds `isCompetitionMentor`.
 */
export function isEngagementMentor(user: PredicateSubject, competition: TeamMentorship): boolean {
  return competition.primaryUserId === user.id || competition.coMentorUserIds.includes(user.id);
}

/** R96: the competition's primary mentor. Feeds `isCompetitionPrimaryMentor`. */
export function isEngagementPrimaryMentor(
  user: PredicateSubject,
  competition: TeamMentorship,
): boolean {
  return competition.primaryUserId === user.id;
}
