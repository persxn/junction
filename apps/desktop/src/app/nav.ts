import type { Action, InstallationMode } from '@compintel/contracts';
import {
  Activity,
  Archive,
  Bell,
  ChartNoAxesCombined,
  Compass,
  Copy,
  Database,
  GraduationCap,
  LayoutDashboard,
  MapPin,
  Radio,
  Tags,
  Trophy,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * The left rail (ARCHITECTURE.md §16.1), as data. The rail renders it, the
 * command palette turns it into "go to" commands, and the router registers it —
 * one list, so the three can never disagree about what exists.
 */

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: LucideIcon;
  /** One line for the palette and the placeholder page. */
  readonly summary: string;
}

export const MAIN_NAV = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    summary: 'What needs attention today: closing soon, overdue work, active teams.',
  },
  {
    id: 'discover',
    label: 'Discover',
    path: '/discover',
    icon: Compass,
    summary: 'Find events — nearby, closing soon, new, and recommended with a reason.',
  },
  {
    id: 'competitions',
    label: 'Competitions',
    path: '/competitions',
    icon: Trophy,
    summary: 'The pipeline from considering an event to completing it.',
  },
  {
    id: 'teams',
    label: 'Teams',
    path: '/teams',
    icon: Users,
    summary: 'Teams, their members, their mentors and what they are working on.',
  },
  {
    id: 'students',
    label: 'Students',
    path: '/students',
    icon: GraduationCap,
    summary: 'Profiles, skills and the competitions each student has taken part in.',
  },
  {
    id: 'insights',
    label: 'Insights',
    path: '/insights',
    icon: ChartNoAxesCombined,
    summary: 'What your department has achieved, counted from what is recorded.',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    icon: Bell,
    summary: 'Deadline reminders, scrape failures and saved-search hits.',
  },
] as const satisfies readonly NavItem[];

/**
 * Every path the router registers. Keeping it a union of literals is what makes
 * `<Link to={item.path}>` and the palette's "go to" commands type-checked.
 */
export type NavPath = (typeof MAIN_NAV)[number]['path'];

/**
 * A screen with no rail item of its own (WP-14): adding an event is something
 * you do *from* somewhere — Discover, the palette, a keyboard shortcut — rather
 * than a place you go and stand in. It is still a route, so a link to it is
 * type-checked like any other.
 */
export const CREATE_EVENT_PATH = '/events/new';

/** Every path the router knows, rail item or not. */
export type AppPath = NavPath | typeof CREATE_EVENT_PATH;

/**
 * The admin section of §16.1.
 *
 * Each item names the §10.2 capability it needs. The rail shows an item only
 * when `/me` says the signed-in account holds that permission, and the router
 * guards the route with the same answer — but neither is the security: §10.1 is
 * explicit that hiding a control is cosmetic and the server re-decides every
 * read and write with `assertCan`.
 */
export interface AdminNavItem extends NavItem {
  /** The permission that reveals it (ruling R32). */
  readonly action: Action;
}

export const ADMIN_NAV = [
  {
    id: 'admin-users',
    label: 'Users',
    path: '/admin/users',
    icon: UserCog,
    action: 'user.manage',
    summary: 'Accounts, roles and password resets.',
  },
  {
    id: 'admin-sources',
    label: 'Sources & scraper',
    path: '/admin/sources',
    icon: Radio,
    action: 'source.manage',
    summary: 'Which sites are scraped, how often, and what went wrong.',
  },
  {
    id: 'admin-categories',
    label: 'Categories & rules',
    path: '/admin/categories',
    icon: Tags,
    action: 'category.manage',
    summary: 'The taxonomy events are sorted into, and the rules that do it.',
  },
  {
    id: 'admin-duplicates',
    label: 'Duplicates',
    path: '/admin/duplicates',
    icon: Copy,
    action: 'duplicate.review',
    summary: 'Events the matcher thinks are the same, waiting for a decision.',
  },
  {
    id: 'admin-campus',
    label: 'Campus & settings',
    path: '/admin/settings',
    icon: MapPin,
    action: 'settings.manage',
    summary: 'Where the institution is, and how the app behaves.',
  },
  {
    id: 'admin-backups',
    label: 'Backups',
    path: '/admin/backups',
    icon: Database,
    action: 'backup.restore',
    summary: 'Scheduled backups, restores and their history.',
  },
  {
    id: 'admin-audit',
    label: 'Audit log',
    path: '/admin/audit',
    icon: Archive,
    action: 'audit.view_all',
    summary: 'Everything that happened, in order, with its hash chain.',
  },
  {
    id: 'admin-health',
    label: 'System health',
    path: '/admin/health',
    icon: Activity,
    action: 'system.health.view',
    summary: 'Jobs, disk, the LLM sidecar and the freshness of every source.',
  },
] as const satisfies readonly AdminNavItem[];

export type AdminPath = (typeof ADMIN_NAV)[number]['path'];

/**
 * WP-34 (R133–R135): the rail as a student install shows it. The paths, icons
 * and guards are the same items; only the words change, and the admin section
 * keeps what a student runs — Sources (to connect their own accounts) and
 * Settings, plus Users for an institution's lead. Everything else stays reachable
 * by URL for an administrator, as the server still allows it.
 */
const STUDENT_ADMIN_IDS: Readonly<Record<'individual' | 'institution', readonly string[]>> = {
  individual: ['admin-sources', 'admin-campus'],
  institution: ['admin-users', 'admin-sources', 'admin-campus'],
};

const STUDENT_LABELS: Readonly<Record<string, { label: string; summary: string }>> = {
  students: {
    label: 'Teammates',
    summary: 'The people you compete with: skills, teams and competitions.',
  },
  insights: {
    label: 'Insights',
    summary: 'What you have achieved, counted from what is recorded.',
  },
  'admin-campus': { label: 'Settings', summary: 'Where you are, and how the app behaves.' },
  'admin-users': { label: 'Members', summary: 'Profiles on this computer, and guest access.' },
};

export interface NavView {
  readonly main: readonly NavItem[];
  readonly admin: readonly AdminNavItem[];
}

export function navFor(mode: InstallationMode | undefined): NavView {
  if (mode === undefined || mode === 'DEPARTMENT') {
    return { main: MAIN_NAV, admin: ADMIN_NAV };
  }
  const relabel = <T extends NavItem>(item: T): T => ({ ...item, ...STUDENT_LABELS[item.id] });
  const keep = STUDENT_ADMIN_IDS[mode === 'STUDENT_INDIVIDUAL' ? 'individual' : 'institution'];
  return {
    main: MAIN_NAV.map(relabel),
    admin: ADMIN_NAV.filter((item) => keep.includes(item.id)).map(relabel),
  };
}
