/**
 * The data key a test backend runs with (ruling R76).
 *
 * Its own module rather than a constant inside a harness: both the scrape
 * harness and the route server need it, and a fixed value is what lets a test
 * assert that what lands in `settings` is ciphertext and not the cookie.
 *
 * Not a secret. It seals fixtures.
 */
export const TEST_SESSION_KEY_HEX = '5e'.repeat(32);
