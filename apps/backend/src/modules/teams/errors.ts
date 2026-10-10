import { AppError } from '../../platform/errors.js';

/**
 * The `TEAM_` problems (R12, WP-18). A team's name is not personal data and may
 * appear; a student's never does (R92).
 */

export const teamNotFound = (): AppError =>
  new AppError({
    code: 'TEAM_NOT_FOUND',
    status: 404,
    title: 'No such team',
    detail: 'That team does not exist.',
    retryable: false,
  });

export const teamNameTaken = (name: string): AppError =>
  new AppError({
    code: 'TEAM_NAME_TAKEN',
    status: 409,
    title: 'That team name is in use',
    detail: `An active team is already called “${name}”.`,
    hint: 'Choose another name, or archive the other team first.',
    retryable: false,
  });

export const teamArchived = (): AppError =>
  new AppError({
    code: 'TEAM_ARCHIVED',
    status: 409,
    title: 'This team is archived',
    detail: 'An archived team is read-only.',
    hint: 'Unarchive it to make changes.',
    retryable: false,
  });

/** WP-18's ground rule, in the words the UI shows. */
export const teamVersionConflict = (): AppError =>
  new AppError({
    code: 'TEAM_VERSION_CONFLICT',
    status: 409,
    title: 'Someone else changed this team',
    detail: 'Someone else changed this team — reload to see their changes.',
    hint: 'Reload the team, then make your change again.',
    retryable: false,
  });

export const memberExists = (): AppError =>
  new AppError({
    code: 'TEAM_MEMBER_EXISTS',
    status: 409,
    title: 'Already in the team',
    detail: 'That student is already a member of this team.',
    retryable: false,
  });

export const memberNotFound = (): AppError =>
  new AppError({
    code: 'TEAM_MEMBER_NOT_FOUND',
    status: 404,
    title: 'No such member',
    detail: 'That membership does not exist in this team, or has already ended.',
    retryable: false,
  });

export const studentNotActive = (): AppError =>
  new AppError({
    code: 'TEAM_STUDENT_NOT_ACTIVE',
    status: 422,
    title: 'Only active students can join',
    detail: 'That student is inactive, has graduated or was erased, so cannot join a team.',
    hint: 'Reactivate the student first if they are back.',
    retryable: false,
  });

export const mentorNotProfessor = (): AppError =>
  new AppError({
    code: 'TEAM_MENTOR_NOT_PROFESSOR',
    status: 422,
    title: 'That account cannot look after a team',
    detail:
      'A team mentor or owner must be an active account with the Professor role, or the Student role on a student install.',
    retryable: false,
  });

export const mentorExists = (): AppError =>
  new AppError({
    code: 'TEAM_MENTOR_EXISTS',
    status: 409,
    title: 'Already a mentor',
    detail: 'That professor already mentors this team.',
    retryable: false,
  });

export const mentorNotFound = (): AppError =>
  new AppError({
    code: 'TEAM_MENTOR_NOT_FOUND',
    status: 404,
    title: 'No such mentor',
    detail: 'That co-mentor does not exist in this team, or has already stepped down.',
    hint: 'The primary mentor is changed with “Transfer primary”, not removed.',
    retryable: false,
  });

export const leadNotMember = (): AppError =>
  new AppError({
    code: 'TEAM_LEAD_NOT_MEMBER',
    status: 422,
    title: 'The lead must be a member',
    detail: 'Only a current member can be the team lead, and a team has one lead at most.',
    retryable: false,
  });
