import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Where "Assign" is pressed from — a Discover card, the **A** key, the event
 * drawer's header — and the one dialog they all open (WP-19 step 5). The
 * dialog loads on first use, so Discover's chunk does not carry it.
 */

const AssignDialog = lazy(() =>
  import('./AssignDialog.js').then((module) => ({ default: module.AssignDialog })),
);

export interface AssignTarget {
  readonly id: string;
  readonly title: string;
}

interface AssignApi {
  readonly open: (event: AssignTarget) => void;
}

const AssignContext = createContext<AssignApi | undefined>(undefined);

export function AssignProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [event, setEvent] = useState<AssignTarget | undefined>(undefined);
  const api = useMemo<AssignApi>(() => ({ open: setEvent }), []);
  return (
    <AssignContext.Provider value={api}>
      {children}
      {event !== undefined && (
        <Suspense fallback={null}>
          <AssignDialog
            key={event.id}
            event={event}
            onClose={() => {
              setEvent(undefined);
            }}
          />
        </Suspense>
      )}
    </AssignContext.Provider>
  );
}

export function useAssign(): AssignApi {
  const api = useContext(AssignContext);
  if (api === undefined) throw new Error('useAssign() needs an <AssignProvider> above it');
  return api;
}
