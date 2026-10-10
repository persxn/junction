import { Dialog } from '../components/Dialog.js';
import { Logo } from '../components/Logo.js';
import { openExternal } from '../lib/external.js';
import { JUNCTION_REPOSITORY, JUNCTION_VERSION } from '../version.js';
import { useInstallation } from './installation.js';
import type { InstallationMode } from '@compintel/contracts';

/** Credits the licences require to be shown, not only shipped (CC BY 4.0 for GeoNames). */
const CREDITS: readonly { name: string; note: string; url: string }[] = [
  {
    name: 'GeoNames',
    note: 'Place names and coordinates for “nearby” distances, CC BY 4.0.',
    url: 'https://www.geonames.org/',
  },
  {
    name: 'Catppuccin',
    note: 'The Latte, Frappé, Macchiato and Mocha colour palettes, MIT.',
    url: 'https://catppuccin.com/',
  },
  {
    name: 'Node.js, Tauri, React, SQLite',
    note: 'The runtime and libraries Junction is built on; their licences ship with it.',
    url: `${JUNCTION_REPOSITORY}#licence`,
  },
];

/** WP-34 (R130): the three kinds of install, as the About box names them. */
const MODE_NAMES: Readonly<Record<InstallationMode, string>> = {
  DEPARTMENT: 'a department',
  STUDENT_INDIVIDUAL: 'a student, for themselves',
  STUDENT_INSTITUTION: 'students, for an institution',
};

function ExternalLink({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      href={url}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(url);
      }}
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

/** About Junction: version, source, licence and credits. */
export function AboutDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const { mode } = useInstallation();
  return (
    <Dialog title="About Junction" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-center gap-3">
          <Logo size={48} />
          <div>
            <p className="font-display text-lg font-semibold">Junction</p>
            <p className="text-fg-muted">Version {JUNCTION_VERSION}</p>
          </div>
        </div>
        <p>
          Find, track and win student competitions — hackathons, CTFs, coding contests and
          innovation challenges — for a whole department or a student, on one Windows PC. Your data
          stays on this computer.
        </p>
        <p className="text-fg-muted">This install: {MODE_NAMES[mode]}.</p>
        <p>
          Open source under the MIT licence.{' '}
          <ExternalLink url={JUNCTION_REPOSITORY}>Source code, issues and releases</ExternalLink>
        </p>
        <section aria-labelledby="about-credits">
          <h3 id="about-credits" className="mb-1 font-medium">
            Credits
          </h3>
          <ul className="flex flex-col gap-1">
            {CREDITS.map((credit) => (
              <li key={credit.name}>
                <ExternalLink url={credit.url}>{credit.name}</ExternalLink>{' '}
                <span className="text-fg-muted">— {credit.note}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Dialog>
  );
}
