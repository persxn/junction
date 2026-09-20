import type { NormalizeCase } from './case.js';

/**
 * Mode, event type, recurring rounds and edition year (§7.3, A11, D-08).
 *
 * These four decide where an event *appears*: the feed, the Contest Calendar, or
 * hidden by the event-type policy. Getting them wrong does not corrupt data, it
 * buries it — which is why the keyword rules are specific and anything unmatched
 * falls to `OTHER`/`UNKNOWN` rather than to the nearest guess.
 */

export const CLASSIFY_CASES: readonly NormalizeCase[] = [
  // ---- Mode ----------------------------------------------------------------
  {
    name: 'an explicit mode field beats every keyword',
    input: { mode: 'ONLINE', title: 'On-campus hackathon at IIT Bombay' },
    expect: { fields: { 'mode.value': 'ONLINE', 'mode.confidence': 1 } },
  },
  {
    name: '"virtual" in the source field means online',
    input: { mode: 'virtual' },
    expect: { fields: { 'mode.value': 'ONLINE' } },
  },
  {
    name: '"in-person" in the source field means offline',
    input: { mode: 'in-person' },
    expect: { fields: { 'mode.value': 'OFFLINE' } },
  },
  {
    name: 'online keywords with no venue mean online',
    input: { title: 'Remote CTF', description: 'Play from anywhere in the world.' },
    expect: { fields: { 'mode.value': 'ONLINE' } },
  },
  {
    name: 'a named venue with no online keyword means offline',
    input: { place: { venueName: 'Powai Campus', city: 'Mumbai', countryCode: 'IN' } },
    expect: { fields: { 'mode.value': 'OFFLINE' } },
  },
  {
    name: 'online keywords AND a venue mean hybrid, with a warning',
    input: {
      title: 'HackNight',
      description: 'Join online or come to the venue.',
      place: { venueName: 'Main Auditorium', city: 'Pune', countryCode: 'IN' },
    },
    expect: { warnings: ['MODE_CONFLICT'], fields: { 'mode.value': 'HYBRID' } },
  },
  {
    name: 'the word "hybrid" is taken at face value',
    input: { description: 'This is a hybrid event.' },
    expect: { fields: { 'mode.value': 'HYBRID' } },
  },
  {
    name: 'nothing about the format at all is UNKNOWN, not a guess',
    input: {},
    expect: { fields: { 'mode.value': 'UNKNOWN' } },
  },
  {
    name: 'an unrecognised source mode falls through to the keywords',
    input: { mode: 'tbd', description: 'Fully remote participation.' },
    expect: { fields: { 'mode.value': 'ONLINE' } },
  },

  // ---- Event type ----------------------------------------------------------
  {
    name: "the source's own category wins",
    input: { sourceType: 'hackathon', title: 'Capture the Flag 2026' },
    expect: { fields: { 'eventType.value': 'HACKATHON', 'eventType.confidence': 1 } },
  },
  {
    name: '"ctf" as a source category maps to CTF',
    input: { sourceType: 'ctf' },
    expect: { fields: { 'eventType.value': 'CTF' } },
  },
  {
    name: '"ideathon" in the title beats the "hack" substring',
    input: { title: 'HackIdea Ideathon 2026' },
    expect: { fields: { 'eventType.value': 'IDEATHON' } },
  },
  {
    name: '"capture the flag" in the title is a CTF',
    input: { title: 'InCTF — Capture the Flag' },
    expect: { fields: { 'eventType.value': 'CTF' } },
  },
  {
    name: 'a hackathon is a hackathon',
    input: { title: 'Smart India Hackathon' },
    expect: { fields: { 'eventType.value': 'HACKATHON' } },
  },
  {
    name: '"innovation challenge" maps to INNOVATION_CHALLENGE',
    input: { title: 'Tata Innovation Challenge' },
    expect: { fields: { 'eventType.value': 'INNOVATION_CHALLENGE' } },
  },
  {
    name: 'a named judge platform implies a coding contest',
    input: { title: 'Codeforces Round 918 (Div. 2)' },
    expect: { fields: { 'eventType.value': 'CODING_CONTEST' } },
  },
  {
    name: '"programming contest" maps to CODING_CONTEST',
    input: { title: 'ACM Programming Contest — Regional' },
    expect: { fields: { 'eventType.value': 'CODING_CONTEST' } },
  },
  {
    name: "a single-purpose source's default applies when no rule matches",
    input: { title: 'Something Unrecognisable' },
    ctx: { sourceEventType: 'CTF' },
    expect: { fields: { 'eventType.value': 'CTF' } },
  },
  {
    name: 'nothing recognisable and no default is OTHER',
    input: { title: 'Annual Cultural Meet' },
    expect: { fields: { 'eventType.value': 'OTHER', 'eventType.confidence': 1 } },
  },
  {
    name: 'an unmappable source category warns and falls back to keywords',
    input: { sourceType: 'quiz-bowl', title: 'Some Hackathon' },
    expect: { warnings: ['EVENT_TYPE_UNMAPPED'], fields: { 'eventType.value': 'HACKATHON' } },
  },

  // ---- Recurring rounds ----------------------------------------------------
  {
    name: 'a Codeforces round is recurring, with the number stripped',
    input: { title: 'Codeforces Round 918 (Div. 2)' },
    expect: { fields: { isRecurringRound: true, seriesHint: 'Codeforces Round' } },
  },
  {
    name: 'the next Codeforces round produces the same series hint',
    input: { title: 'Codeforces Round #919 (Div. 1)' },
    expect: { fields: { isRecurringRound: true, seriesHint: 'Codeforces Round' } },
  },
  {
    name: 'a LeetCode weekly contest is recurring',
    input: { title: 'Weekly Contest 377' },
    expect: { fields: { isRecurringRound: true, seriesHint: 'Weekly Contest' } },
  },
  {
    name: 'a biweekly contest is recurring',
    input: { title: 'Biweekly Contest 120' },
    expect: { fields: { isRecurringRound: true, seriesHint: 'Biweekly Contest' } },
  },
  {
    name: 'CodeChef Starters is recurring',
    input: { title: 'CodeChef Starters 115' },
    expect: { fields: { isRecurringRound: true, seriesHint: 'CodeChef Starters' } },
  },
  {
    name: 'an educational round is recurring',
    input: { title: 'Educational Codeforces Round 160 (Rated for Div. 2)' },
    expect: { fields: { isRecurringRound: true } },
  },
  {
    name: 'a one-off hackathon is not a recurring round',
    input: { title: 'Smart India Hackathon 2026' },
    expect: { fields: { isRecurringRound: false, seriesHint: undefined } },
  },
  {
    name: 'a CTF with a number in the name is not a recurring round',
    input: { title: 'InCTF 2026' },
    expect: { fields: { isRecurringRound: false } },
  },

  // ---- Edition year (A11) --------------------------------------------------
  {
    name: 'the start year is the edition year',
    input: {
      title: 'HackX',
      place: { countryCode: 'IN' },
      startsAt: { structured: '2026-03-14' },
    },
    expect: { fields: { editionYear: 2026 } },
  },
  {
    name: 'a title year that disagrees with the start year loses, and warns',
    input: {
      title: 'HackX 2025',
      place: { countryCode: 'IN' },
      startsAt: { structured: '2026-01-10' },
    },
    expect: { warnings: ['EDITION_YEAR_CONFLICT'], fields: { editionYear: 2026 } },
  },
  {
    name: 'a title year that agrees with the start year raises no warning',
    input: {
      title: 'HackX 2026',
      place: { countryCode: 'IN' },
      startsAt: { structured: '2026-03-14' },
    },
    expect: { noWarnings: ['EDITION_YEAR_CONFLICT'], fields: { editionYear: 2026 } },
  },
  {
    name: 'with no start date, the registration deadline year is used',
    input: {
      title: 'HackX',
      place: { countryCode: 'IN' },
      registrationDeadlineAt: { structured: '2026-02-01' },
    },
    expect: { fields: { editionYear: 2026 } },
  },
  {
    name: 'with no dates at all, the title year is used',
    input: { title: 'HackX 2027' },
    expect: { fields: { editionYear: 2027 } },
  },
  {
    name: 'a year outside 2020–2100 in the title is ignored',
    input: { title: 'HackX 1999' },
    expect: { absent: ['editionYear'] },
  },
  {
    name: 'no year anywhere leaves the edition year absent',
    input: { title: 'HackX' },
    expect: { absent: ['editionYear'] },
  },
  {
    name: 'a dropped out-of-range start date does not become an edition year',
    input: { title: 'HackX', place: { countryCode: 'IN' }, startsAt: { structured: '2087-04-01' } },
    expect: { warnings: ['DATE_OUT_OF_RANGE'], absent: ['editionYear', 'startsAt'] },
  },
];
