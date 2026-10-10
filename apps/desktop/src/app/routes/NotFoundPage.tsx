import { useNavigate } from '@tanstack/react-router';

import { EmptyState } from '../../components/EmptyState.js';

/** Nothing in the app links here; it catches a stale palette entry or a typo. */
export function NotFoundPage(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl">That screen does not exist</h1>
      <EmptyState
        title="Nothing here"
        description="The screen you asked for is not part of Junction."
        action={{
          label: 'Back to the dashboard',
          onAction: () => {
            void navigate({ to: '/' });
          },
        }}
      />
    </section>
  );
}
