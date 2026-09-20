import {
  Bell,
  Compass,
  GraduationCap,
  LayoutDashboard,
  Sparkles,
  Trophy,
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
    id: 'assistant',
    label: 'Assistant',
    path: '/assistant',
    icon: Sparkles,
    summary: 'Ask in plain English and get answers grounded in your own data.',
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
 * The admin section of §16.1.
 *
 * **Seam for WP-07a.** These are listed here so the eventual implementation has
 * one place to start from, but they are deliberately *not* registered as routes
 * and *not* rendered: nothing in the app today knows who is signed in, so any
 * admin navigation would either be a fake permission check or a screen reachable
 * by typing its URL. When WP-07a can answer "is this user an admin", register
 * these under a `beforeLoad` guard and render them from the same list.
 */
export const ADMIN_NAV: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'admin-users', label: 'Users' },
  { id: 'admin-sources', label: 'Sources & scraper' },
  { id: 'admin-categories', label: 'Categories & rules' },
  { id: 'admin-duplicates', label: 'Duplicates' },
  { id: 'admin-campus', label: 'Campus & settings' },
  { id: 'admin-backups', label: 'Backups' },
  { id: 'admin-audit', label: 'Audit log' },
  { id: 'admin-health', label: 'System health' },
] as const;
