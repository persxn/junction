import type { StudentDetail, StudentTagsRequest } from '@compintel/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { setStudentActive, setStudentTags } from '../../api/students.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';

/**
 * The Student page's reversible writes (§16.3, WP-17 step 6): the skill and
 * interest set, and deactivate/reactivate. Each changes the page first and asks
 * the server second; success leaves a toast whose Undo writes the opposite;
 * failure puts the page back and says why. A 409 — someone else changed this
 * student — offers a reload rather than retrying over their change.
 */

export const studentKey = (id: string) => ['students', 'detail', id] as const;

export type TagSet = StudentTagsRequest['tags'];

export const tagSetOf = (student: StudentDetail): TagSet =>
  student.tags.map((tag) => ({
    name: tag.name,
    relation: tag.relation,
    proficiency: tag.proficiency,
  }));

export interface StudentActions {
  readonly saveTags: (student: StudentDetail, next: TagSet, describe: string) => void;
  readonly setActive: (student: StudentDetail, active: boolean) => void;
}

export function useStudentActions(): StudentActions {
  const client = useQueryClient();
  const connection = useBackendConnection();
  const toast = useToast();

  const fail = useCallback(
    (student: StudentDetail, title: string, cause: unknown): void => {
      client.setQueryData(studentKey(student.id), student);
      if (isApiProblem(cause) && cause.status === 409) {
        toast.show({
          tone: 'warning',
          title: 'Someone else changed this student',
          description: 'Someone else changed this student — reload to see their changes.',
          action: {
            label: 'Reload',
            onAction: () => {
              void client.invalidateQueries({ queryKey: studentKey(student.id) });
            },
          },
        });
        return;
      }
      toast.show({
        tone: 'danger',
        title,
        description: isApiProblem(cause)
          ? (cause.detail ?? cause.title)
          : 'The local service did not answer.',
      });
    },
    [client, toast],
  );

  const writeTags = useCallback(
    async (student: StudentDetail, next: TagSet): Promise<StudentDetail | undefined> => {
      client.setQueryData<StudentDetail>(studentKey(student.id), {
        ...student,
        tags: next.map((tag) => ({
          tagId:
            student.tags.find((held) => held.name === tag.name && held.relation === tag.relation)
              ?.tagId ?? '00000000-0000-7000-8000-000000000000',
          ...tag,
        })),
      });
      try {
        const saved = await setStudentTags(connection, student.id, {
          tags: next,
          version: student.version,
        });
        client.setQueryData(studentKey(student.id), saved);
        void client.invalidateQueries({ queryKey: ['students', 'list'] });
        return saved;
      } catch (cause) {
        fail(student, 'The skills and interests were not saved', cause);
        return undefined;
      }
    },
    [client, connection, fail],
  );

  const saveTags = useCallback(
    (student: StudentDetail, next: TagSet, describe: string): void => {
      void writeTags(student, next).then((saved) => {
        if (saved === undefined) return;
        toast.show({
          tone: 'success',
          title: describe,
          action: {
            label: 'Undo',
            onAction: () => {
              void writeTags(saved, tagSetOf(student));
            },
          },
        });
      });
    },
    [toast, writeTags],
  );

  const writeActive = useCallback(
    async (student: StudentDetail, active: boolean): Promise<StudentDetail | undefined> => {
      client.setQueryData<StudentDetail>(studentKey(student.id), {
        ...student,
        status: active ? 'ACTIVE' : 'INACTIVE',
      });
      try {
        const saved = await setStudentActive(connection, student.id, active, student.version);
        client.setQueryData(studentKey(student.id), saved);
        void client.invalidateQueries({ queryKey: ['students', 'list'] });
        return saved;
      } catch (cause) {
        fail(
          student,
          active ? 'The student was not reactivated' : 'The student was not deactivated',
          cause,
        );
        return undefined;
      }
    },
    [client, connection, fail],
  );

  const setActive = useCallback(
    (student: StudentDetail, active: boolean): void => {
      void writeActive(student, active).then((saved) => {
        if (saved === undefined) return;
        toast.show({
          tone: 'info',
          title: active
            ? `${student.fullName} is active again`
            : `${student.fullName} is now inactive`,
          action: {
            label: 'Undo',
            onAction: () => {
              void writeActive(saved, !active);
            },
          },
        });
      });
    },
    [toast, writeActive],
  );

  return useMemo(() => ({ saveTags, setActive }), [saveTags, setActive]);
}
