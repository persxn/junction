import type { RoleKey, UserSummary } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, KeyRound, Loader2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';

import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserEnabled,
  updateUser,
} from '../../../api/admin-users.js';
import { isApiProblem, type ApiProblem } from '../../../api/problem.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { NewUserDialog } from './NewUserDialog.js';
import { OneTimePassword } from './OneTimePassword.js';
import { TransferDialog } from './TransferDialog.js';
import { UserRow } from './UserRow.js';

/**
 * Admin → Users (§10.2 `user.manage`, roadmap WP-07b).
 *
 * Creating an account and resetting a password both hand back a password that
 * exists exactly once, in the response. It is shown in a panel the admin has to
 * dismiss, never written to storage and never fetchable again — the same rule
 * as the wizard's recovery code, for the same reason.
 */

export function UsersPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [issued, setIssued] = useState<{ email: string; password: string } | undefined>(undefined);

  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => listUsers(connection),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  };

  const complain = (cause: unknown): void => {
    const problem = cause as ApiProblem;
    toast.show({
      tone: 'danger',
      title: isApiProblem(cause) ? problem.title : 'That did not work',
      description: isApiProblem(cause) ? (problem.detail ?? '') : String(cause),
    });
  };

  const create = useMutation({
    mutationFn: async (input: { email: string; displayName: string; roles: readonly RoleKey[] }) =>
      createUser(connection, { ...input, roles: [...input.roles] }),
    onSuccess: async (result) => {
      setCreating(false);
      setIssued({ email: result.user.email, password: result.temporaryPassword });
      await invalidate();
    },
    onError: complain,
  });

  const toggle = useMutation({
    mutationFn: async (input: { user: UserSummary; enabled: boolean }) =>
      setUserEnabled(connection, input.user.id, input.enabled),
    onSuccess: invalidate,
    onError: complain,
  });

  const rename = useMutation({
    mutationFn: async (input: { user: UserSummary; displayName: string; roles: RoleKey[] }) =>
      updateUser(connection, input.user.id, {
        displayName: input.displayName,
        roles: input.roles,
        version: input.user.version,
      }),
    onSuccess: invalidate,
    onError: complain,
  });

  const reset = useMutation({
    mutationFn: async (user: UserSummary) => resetUserPassword(connection, user.id),
    onSuccess: async (result) => {
      setIssued({ email: result.user.email, password: result.temporaryPassword });
      await invalidate();
    },
    onError: complain,
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">Users</h1>
          <p className="text-fg-muted">Accounts, roles and password resets.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={users.data === undefined}
            onClick={() => {
              setTransferring(true);
            }}
            className="flex items-center gap-2 rounded-md border border-line px-3 py-2 hover:bg-surface-hover disabled:opacity-50"
          >
            <ArrowRightLeft aria-hidden="true" className="size-4" />
            Transfer ownership…
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
            }}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Add a person
          </button>
        </div>
      </header>

      {issued !== undefined && (
        <OneTimePassword
          email={issued.email}
          password={issued.password}
          onDismiss={() => {
            setIssued(undefined);
          }}
        />
      )}

      {users.isPending && <Skeleton lines={5} label="Loading accounts" />}

      {users.isError && (
        <EmptyState
          icon={Users}
          title="The list of accounts could not be loaded"
          description={
            isApiProblem(users.error)
              ? (users.error.detail ?? users.error.title)
              : String(users.error)
          }
          action={{
            label: 'Try again',
            onAction: () => {
              void users.refetch();
            },
          }}
        />
      )}

      {users.data?.length === 0 && (
        <EmptyState
          icon={Users}
          title="Nobody else yet"
          description="Add the colleagues who will mentor teams. Each one gets a one-time password to change on their first sign-in."
          action={{
            label: 'Add a person',
            onAction: () => {
              setCreating(true);
            },
          }}
        />
      )}

      {users.data !== undefined && users.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Every CompIntel account</caption>
          <thead>
            <tr className="border-b border-line text-sm text-fg-subtle">
              <th scope="col" className="py-2 font-medium">
                Person
              </th>
              <th scope="col" className="py-2 font-medium">
                Roles
              </th>
              <th scope="col" className="py-2 font-medium">
                Status
              </th>
              <th scope="col" className="py-2 font-medium">
                Last signed in
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                busy={toggle.isPending || rename.isPending || reset.isPending}
                onToggle={(enabled) => {
                  toggle.mutate({ user, enabled });
                }}
                onSave={(displayName, roles) => {
                  rename.mutate({ user, displayName, roles });
                }}
                onReset={() => {
                  reset.mutate(user);
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      {transferring && users.data !== undefined && (
        <TransferDialog
          users={users.data}
          onClose={() => {
            setTransferring(false);
            void invalidate();
          }}
        />
      )}

      {creating && (
        <NewUserDialog
          busy={create.isPending}
          onCancel={() => {
            setCreating(false);
          }}
          onCreate={(input) => {
            create.mutate(input);
          }}
        />
      )}

      {reset.isPending && (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          <KeyRound aria-hidden="true" className="size-3.5" />
          Generating a new password…
        </p>
      )}
    </div>
  );
}
