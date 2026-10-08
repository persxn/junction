import { z } from 'zod';

import { Uuid7 } from './ids.js';
import { CompetitionRef } from './engagement-status.js';
import { StudentStatus } from './student-status.js';

/**
 * Teams (§6.2 "Teams", rulings R94–R95, roadmap WP-18): members with a role
 * label and at most one lead, one PRIMARY mentor and any co-mentors, and the
 * skill coverage chips of §16.2.
 */

export const TEAM_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const TeamStatus = z.enum(TEAM_STATUSES);
export type TeamStatus = z.infer<typeof TeamStatus>;

export const TEAM_STATUS_LABELS: Readonly<Record<TeamStatus, string>> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

export const MENTOR_ROLES = ['PRIMARY', 'CO_MENTOR'] as const;
export const MentorRole = z.enum(MENTOR_ROLES);
export type MentorRole = z.infer<typeof MentorRole>;

export const MENTOR_ROLE_LABELS: Readonly<Record<MentorRole, string>> = {
  PRIMARY: 'Primary mentor',
  CO_MENTOR: 'Co-mentor',
};

/** R94's three states. */
export const COVERAGE_STATES = ['COVERED', 'THIN', 'MISSING'] as const;
export const CoverageState = z.enum(COVERAGE_STATES);
export type CoverageState = z.infer<typeof CoverageState>;

export const COVERAGE_STATE_LABELS: Readonly<Record<CoverageState, string>> = {
  COVERED: 'Covered',
  THIN: 'Thin',
  MISSING: 'Missing',
};

/** What each state means, for the legend beside the chips. */
export const COVERAGE_STATE_HINTS: Readonly<Record<CoverageState, string>> = {
  COVERED: 'Two or more members have it, or one has it at Intermediate or above.',
  THIN: 'Only one member has it, as a Beginner or not rated.',
  MISSING: 'A skill the team wants that no active member has.',
};

export const TEAM_NAME_MAX = 80;
export const TEAM_ROLE_LABEL_MAX = 40;
export const TEAM_TARGETS_MAX = 30;
export const TEAM_INITIAL_MEMBERS_MAX = 20;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();
const TeamName = z.string().trim().min(2).max(TEAM_NAME_MAX);
const Version = z.int().min(1);

export const CoverageCounts = z
  .object({ covered: z.int().min(0), thin: z.int().min(0), missing: z.int().min(0) })
  .strict();
export type CoverageCounts = z.infer<typeof CoverageCounts>;

export const CoverageChip = z
  .object({
    name: z.string().min(1),
    state: CoverageState,
    /** Active members holding the skill. */
    holders: z.int().min(0),
    isTarget: z.boolean(),
  })
  .strict();
export type CoverageChip = z.infer<typeof CoverageChip>;

export const TeamCoverage = z
  .object({ chips: z.array(CoverageChip), counts: CoverageCounts })
  .strict();
export type TeamCoverage = z.infer<typeof TeamCoverage>;

export const TeamPerson = z.object({ userId: Uuid7, displayName: z.string().min(1) }).strict();
export type TeamPerson = z.infer<typeof TeamPerson>;

export const TeamListItem = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    status: TeamStatus,
    memberCount: z.int().min(0),
    primaryMentor: TeamPerson.nullable(),
    coverage: CoverageCounts,
    /** The caller is the primary or a co-mentor ("My teams"). */
    isMine: z.boolean(),
    version: Version,
  })
  .strict();
export type TeamListItem = z.infer<typeof TeamListItem>;

export const TeamMember = z
  .object({
    id: Uuid7,
    studentId: Uuid7,
    fullName: z.string().min(1),
    universityId: z.string().min(1),
    studentStatus: StudentStatus,
    /** Skill names, for the member row. */
    skills: z.array(z.string()),
    roleLabel: z.string().nullable(),
    isLead: z.boolean(),
    joinedAt: z.iso.datetime(),
    leftAt: z.iso.datetime().nullable(),
  })
  .strict();
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamMentor = z
  .object({
    id: Uuid7,
    userId: Uuid7,
    displayName: z.string().min(1),
    role: MentorRole,
    fromAt: z.iso.datetime(),
    toAt: z.iso.datetime().nullable(),
  })
  .strict();
export type TeamMentor = z.infer<typeof TeamMentor>;

/** What the caller may do — cosmetic, the server decides again (§10.1). */
export const TeamAbilities = z
  .object({
    edit: z.boolean(),
    archive: z.boolean(),
    manageMentors: z.boolean(),
    transferPrimary: z.boolean(),
  })
  .strict();
export type TeamAbilities = z.infer<typeof TeamAbilities>;

export const TeamDetail = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    description: z.string().nullable(),
    status: TeamStatus,
    createdAt: z.iso.datetime(),
    /** Open memberships first, then the closed ones (R95 keeps them). */
    members: z.array(TeamMember),
    pastMembers: z.array(TeamMember),
    mentors: z.array(TeamMentor),
    pastMentors: z.array(TeamMentor),
    /** WP-19: the team's competitions, open ones first. */
    competitions: z.array(CompetitionRef),
    targets: z.array(z.string()),
    coverage: TeamCoverage,
    can: TeamAbilities,
    version: Version,
  })
  .strict();
export type TeamDetail = z.infer<typeof TeamDetail>;

export const TeamListQuery = z
  .object({
    text: z.string().trim().max(100).optional(),
    status: TeamStatus.optional(),
    /** `me`, or a professor's id. */
    mentor: z.union([z.literal('me'), Uuid7]).optional(),
    studentId: Uuid7.optional(),
  })
  .strict();
export type TeamListQuery = z.infer<typeof TeamListQuery>;

export const TeamListResponse = z
  .object({ items: z.array(TeamListItem), total: z.int().min(0) })
  .strict();
export type TeamListResponse = z.infer<typeof TeamListResponse>;

const SkillNames = z.array(text(60)).max(TEAM_TARGETS_MAX);
const RoleLabel = optionalText(TEAM_ROLE_LABEL_MAX);

export const TeamMemberInput = z
  .object({ studentId: Uuid7, roleLabel: RoleLabel, isLead: z.boolean().optional() })
  .strict();
export type TeamMemberInput = z.infer<typeof TeamMemberInput>;

export const TeamCreateRequest = z
  .object({
    name: TeamName,
    description: optionalText(500),
    /** Skill names; an unknown one becomes a new SKILL tag (R94). */
    targets: SkillNames.default([]),
    members: z.array(TeamMemberInput).max(TEAM_INITIAL_MEMBERS_MAX).default([]),
    /** R95: an administrator names the primary; anyone else is the primary themself. */
    primaryUserId: Uuid7.optional(),
  })
  .strict();
export type TeamCreateRequest = z.infer<typeof TeamCreateRequest>;
export type TeamCreateInput = z.input<typeof TeamCreateRequest>;

export const TeamUpdateRequest = z
  .object({
    name: TeamName.optional(),
    description: optionalText(500),
    targets: SkillNames.optional(),
    version: Version,
  })
  .strict();
export type TeamUpdateRequest = z.infer<typeof TeamUpdateRequest>;

export const TeamAddMemberRequest = TeamMemberInput.extend({ version: Version }).strict();
export type TeamAddMemberRequest = z.infer<typeof TeamAddMemberRequest>;

export const TeamUpdateMemberRequest = z
  .object({ roleLabel: RoleLabel, isLead: z.boolean().optional(), version: Version })
  .strict();
export type TeamUpdateMemberRequest = z.infer<typeof TeamUpdateMemberRequest>;

export const TeamVersionRequest = z.object({ version: Version }).strict();
export type TeamVersionRequest = z.infer<typeof TeamVersionRequest>;

export const TeamAddMentorRequest = z.object({ userId: Uuid7, version: Version }).strict();
export type TeamAddMentorRequest = z.infer<typeof TeamAddMentorRequest>;

export const TeamTransferPrimaryRequest = z
  .object({ toUserId: Uuid7, stepAway: z.boolean(), version: Version })
  .strict();
export type TeamTransferPrimaryRequest = z.infer<typeof TeamTransferPrimaryRequest>;

/** `GET /professors` — the pickers' list of ACTIVE professors. */
export const ProfessorList = z.object({ professors: z.array(TeamPerson) }).strict();
export type ProfessorList = z.infer<typeof ProfessorList>;

/** One of a student's teams, on the Student page (WP-18 step 5). */
export const StudentTeam = z
  .object({
    teamId: Uuid7,
    teamName: z.string().min(1),
    teamStatus: TeamStatus,
    roleLabel: z.string().nullable(),
    isLead: z.boolean(),
    joinedAt: z.iso.datetime(),
    leftAt: z.iso.datetime().nullable(),
  })
  .strict();
export type StudentTeam = z.infer<typeof StudentTeam>;
