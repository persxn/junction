import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, UserX } from 'lucide-react';

import { isApiProblem } from '../../api/problem.js';
import {
  createStudent,
  getStudent,
  studentFormOptions,
  updateStudent,
} from '../../api/students.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { emptyForm, formFromStudent, toCreateRequest, toUpdateRequest } from './form-model.js';
import { StudentForm } from './StudentForm.js';
import { studentKey } from './use-student-actions.js';

/** "Add a student" and "Edit" (WP-17 step 6) — one form, two routes. */

const problemText = (error: unknown): string | undefined =>
  error === null || error === undefined
    ? undefined
    : isApiProblem(error)
      ? error.status === 409 && error.code === 'STUDENT_VERSION_CONFLICT'
        ? 'Someone else changed this student while you were editing. Reload the page to see their changes.'
        : (error.detail ?? error.title)
      : 'The local service did not answer.';

function FormGuide(): React.JSX.Element {
  return (
    <Guide id="student-form" title="Filling in this form">
      <p>
        Only the <strong>roll number</strong>, <strong>full name</strong> and{' '}
        <strong>programme</strong> are required; everything else can be added later. A roll number
        belongs to one student — spaces and capital letters do not matter, so “21cs 1042” and
        “21CS1042” are the same student.
      </p>
      <p>
        Tick <strong>the privacy notice</strong> once the student has been told what Junction keeps
        about them. Notes are for mentoring only; the student may ask to see them.
      </p>
    </Guide>
  );
}

export function NewStudentPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const options = useQuery({
    queryKey: ['students', 'options'],
    queryFn: () => studentFormOptions(connection),
  });
  const create = useMutation({
    mutationFn: (body: Parameters<typeof createStudent>[1]) => createStudent(connection, body),
    onSuccess: (saved) => {
      client.setQueryData(studentKey(saved.id), saved);
      void client.invalidateQueries({ queryKey: ['students', 'list'] });
      toast.show({ tone: 'success', title: `${saved.fullName} was added` });
      void navigate({ to: '/students/$studentId', params: { studentId: saved.id } });
    },
  });
  if (options.isPending) return <Skeleton lines={6} label="Loading the form" />;
  if (options.isError) {
    return (
      <EmptyState
        title="The form could not be loaded"
        description={problemText(options.error) ?? ''}
        action={{ label: 'Try again', onAction: () => void options.refetch() }}
      />
    );
  }
  const managing =
    options.data.departments.find((department) => department.isManaging) ??
    options.data.departments[0];
  return (
    <section aria-labelledby="new-student-heading" className="flex flex-col gap-4">
      <Link
        to="/students"
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All students
      </Link>
      <h1 id="new-student-heading" className="font-display text-xl">
        Add a student
      </h1>
      <FormGuide />
      <StudentForm
        mode="create"
        initial={emptyForm(managing?.id ?? '')}
        options={options.data}
        busy={create.isPending}
        serverError={problemText(create.error)}
        onCancel={() => void navigate({ to: '/students' })}
        onSubmit={(form) => {
          create.mutate(toCreateRequest(form, options.data.settings));
        }}
      />
    </section>
  );
}

export function EditStudentPage(): React.JSX.Element {
  const { studentId } = useParams({ from: '/students/$studentId/edit' });
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const options = useQuery({
    queryKey: ['students', 'options'],
    queryFn: () => studentFormOptions(connection),
  });
  const student = useQuery({
    queryKey: studentKey(studentId),
    queryFn: () => getStudent(connection, studentId),
  });
  const update = useMutation({
    mutationFn: (body: Parameters<typeof updateStudent>[2]) =>
      updateStudent(connection, studentId, body),
    onSuccess: (saved) => {
      client.setQueryData(studentKey(studentId), saved);
      void client.invalidateQueries({ queryKey: ['students', 'list'] });
      void navigate({ to: '/students/$studentId', params: { studentId } });
    },
  });
  if (options.isPending || student.isPending)
    return <Skeleton lines={6} label="Loading the form" />;
  if (options.isError || student.isError) {
    return (
      <EmptyState
        icon={UserX}
        title="This student could not be loaded"
        description={problemText(options.error ?? student.error) ?? ''}
        action={{ label: 'Back to students', onAction: () => void navigate({ to: '/students' }) }}
      />
    );
  }
  const data = student.data;
  return (
    <section aria-labelledby="edit-student-heading" className="flex flex-col gap-4">
      <Link
        to="/students/$studentId"
        params={{ studentId }}
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to {data.fullName}
      </Link>
      <h1 id="edit-student-heading" className="font-display text-xl">
        Edit {data.fullName}
      </h1>
      <FormGuide />
      <StudentForm
        mode="edit"
        initial={formFromStudent(data)}
        options={options.data}
        busy={update.isPending}
        serverError={problemText(update.error)}
        onCancel={() => void navigate({ to: '/students/$studentId', params: { studentId } })}
        onSubmit={(form) => {
          update.mutate(toUpdateRequest(form, options.data.settings, data.version));
        }}
      />
    </section>
  );
}
