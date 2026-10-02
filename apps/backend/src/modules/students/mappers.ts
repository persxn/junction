import type { StudentDetail, StudentListItem, StudentTeam } from '@compintel/contracts';

import type { StudentRow } from '../../db/schema/index.js';
import type { AuditLog } from '../../platform/audit.js';
import type { SettingsStore } from '../../platform/settings.js';
import type { Clock } from '../../platform/time.js';
import type { Principal } from '../auth/types.js';
import type {
  AchievementRow,
  MentorshipRef,
  RelationsRepository,
  StudentTagRef,
} from './relations-repo.js';
import type { ListCursor, ListRow, StudentsRepository } from './repository.js';
import type { TeamLinksRepository } from './team-links-repo.js';

/** What every students service holds. */
export interface StudentsDependencies {
  readonly students: StudentsRepository;
  readonly relations: RelationsRepository;
  /** WP-18: the student's teams and their mentors. */
  readonly teamLinks: TeamLinksRepository;
  readonly audit: AuditLog;
  readonly settings: SettingsStore;
  readonly clock?: Clock;
}

export interface StudentsContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

const iso = (at: number | null): string | null => (at === null ? null : new Date(at).toISOString());

/** Opaque to the client: base64url of the last row's sort key. */
export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify([cursor.name, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(text: string | undefined): ListCursor | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { name: parsed[0], id: parsed[1] };
    }
  } catch {
    // An unreadable cursor reads as the first page, never as an error page.
  }
  return undefined;
}

export function toListItem(
  row: ListRow,
  tags: readonly StudentTagRef[],
  mentors: readonly MentorshipRef[],
  actorId: string,
): StudentListItem {
  const open = mentors.filter((mentor) => mentor.endedAt === null);
  return {
    id: row.id,
    universityId: row.universityId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    institutionalEmail: row.institutionalEmail,
    program: row.program,
    branch: row.branch,
    graduationYear: row.graduationYear,
    status: row.status,
    isExternal: row.isExternal === 1,
    homeDepartmentName: row.homeDepartmentName,
    tags: tags.map((tag) => ({ name: tag.name, relation: tag.relation })),
    mentorNames: open.map((mentor) => mentor.mentorName),
    isMine: open.some((mentor) => mentor.mentorUserId === actorId),
    erased: row.erasedAt !== null,
    version: row.version,
  };
}

export interface DetailParts {
  readonly row: StudentRow;
  readonly departmentName: string | null;
  readonly tags: readonly StudentTagRef[];
  readonly mentors: readonly MentorshipRef[];
  readonly achievements: readonly AchievementRow[];
  readonly teams: readonly StudentTeam[];
  readonly phoneEnabled: boolean;
  readonly canDeactivate: boolean;
  readonly canErase: boolean;
}

export function toDetail(parts: DetailParts): StudentDetail {
  const { row } = parts;
  return {
    id: row.id,
    universityId: row.universityId,
    fullName: row.fullName,
    preferredName: row.preferredName,
    institutionalEmail: row.institutionalEmail,
    ...(parts.phoneEnabled ? { phone: row.phone } : {}),
    homeDepartmentId: row.homeDepartmentId,
    homeDepartmentName: parts.departmentName,
    program: row.program,
    branch: row.branch,
    graduationYear: row.graduationYear,
    isExternal: row.isExternal,
    externalInstitution: row.externalInstitution,
    status: row.status,
    notes: row.notes,
    privacyNoticeAckAt: iso(row.privacyNoticeAckAt),
    createdAt: new Date(row.createdAt).toISOString(),
    erasedAt: iso(row.erasedAt),
    tags: parts.tags.map((tag) => ({
      tagId: tag.tagId,
      name: tag.name,
      relation: tag.relation,
      proficiency: tag.proficiency,
    })),
    mentors: parts.mentors.map((mentor) => ({
      mentorshipId: mentor.id,
      userId: mentor.mentorUserId,
      displayName: mentor.mentorName,
      startedAt: new Date(mentor.startedAt).toISOString(),
      endedAt: iso(mentor.endedAt),
      note: mentor.note,
    })),
    achievements: parts.achievements.map((achievement) => ({
      id: achievement.id,
      title: achievement.title,
      eventName: achievement.eventName,
      year: achievement.year,
      result: achievement.result,
      url: achievement.url,
      notes: achievement.notes,
    })),
    teams: [...parts.teams],
    canDeactivate: parts.canDeactivate,
    canErase: parts.canErase,
    version: row.version,
  };
}
