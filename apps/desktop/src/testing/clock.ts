/**
 * The one instant the UI tests pretend it is: noon in Asia/Kolkata.
 *
 * It lives on its own because both `fake-search.ts` and `event-detail.ts` need
 * it and one imports the other — a constant defined in either would be
 * `undefined` in whichever module the bundler happened to evaluate first, and
 * the symptom (a date that silently becomes `null` over JSON) is exactly the
 * kind of thing these fixtures exist to catch rather than cause.
 */
export const NOW = Date.parse('2026-09-22T06:30:00.000Z');
