/**
 * Every setting the backend has, in one import.
 *
 * Definitions live with the module that owns them; this file exists so that
 * anything enumerating the whole registry — the admin screen, a diagnostics
 * dump, the tests that assert each key has a schema and a description — sees all
 * of them rather than only the ones its own imports happened to pull in.
 *
 * A module reading its own setting does **not** go through here: it imports the
 * handle directly, which is what makes the definition load before the read.
 * Adding a module means adding one line here.
 */

export * from './modules/auth/settings.js';
export * from './modules/backup/settings.js';
export * from './modules/events/settings.js';
export * from './modules/geo/settings.js';
export * from './modules/org/settings.js';
