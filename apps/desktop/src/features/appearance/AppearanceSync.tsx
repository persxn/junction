import { coerceAppearance, type Appearance, type AppearanceInput } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAppearance, saveAppearance } from '../../api/appearance.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { useAppearance } from '../../theme/appearance-context.js';

export const APPEARANCE_QUERY_KEY = ['me', 'appearance'] as const;

/**
 * Brings the signed-in account's appearance (WP-33, R67–R68) onto the screen.
 * Rendered once, inside the shell; renders nothing.
 */
export function AppearanceSync(): null {
  const connection = useBackendConnection();
  const { setAppearance } = useAppearance();
  const query = useQuery({
    queryKey: APPEARANCE_QUERY_KEY,
    queryFn: () => getAppearance(connection),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (query.data !== undefined) setAppearance(query.data);
  }, [query.data, setAppearance]);
  return null;
}

/** Saves a change: on screen at once, put back as it was if the server refuses. */
export function useSaveAppearance(): (input: AppearanceInput) => void {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const { appearance, setAppearance } = useAppearance();
  const mutation = useMutation({
    mutationFn: (input: AppearanceInput) => saveAppearance(connection, input),
    onSuccess: (saved: Appearance) => {
      client.setQueryData(APPEARANCE_QUERY_KEY, saved);
      setAppearance(saved);
    },
  });
  return (input) => {
    const before = appearance;
    setAppearance(coerceAppearance({ ...appearance, ...input }));
    mutation.mutate(input, {
      onError: () => {
        setAppearance(before);
        toast.show({
          tone: 'danger',
          title: 'Appearance not saved',
          description: 'The change was put back. Try again in a moment.',
        });
      },
    });
  };
}
