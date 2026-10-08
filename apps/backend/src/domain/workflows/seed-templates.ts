import type { DeadlineKind, DueRule, EventType } from '@compintel/contracts';

/**
 * The five department-default workflow templates (§11, WP-20a step 4, R101),
 * as data. Fixed ids, so seeding is "insert if absent" and a second run — at
 * setup completion and again at every startup — finds them and does nothing.
 * OTHER gets no preselected template.
 */

export interface SeedStage {
  readonly name: string;
  readonly weight: number;
  readonly rule: DueRule;
  readonly tasks: readonly string[];
}

export interface SeedTemplate {
  readonly id: string;
  readonly name: string;
  readonly eventType: EventType;
  readonly description: string;
  readonly stages: readonly SeedStage[];
}

const REG = (offsetDays: number): DueRule => ({ anchor: 'REGISTRATION_DEADLINE', offsetDays });
const SUB = (offsetDays: number): DueRule => ({ anchor: 'SUBMISSION_DEADLINE', offsetDays });
const START = (offsetDays: number): DueRule => ({ anchor: 'EVENT_START', offsetDays });
const END = (offsetDays: number): DueRule => ({ anchor: 'EVENT_END', offsetDays });
const D = (kind: DeadlineKind, offsetDays: number): DueRule => ({
  anchor: 'DEADLINE',
  kind,
  offsetDays,
});

const WRAP_UP = ['Record the outcome', 'Collect certificates', 'Share what we learned'];

/** `0192f0c0-0000-7000-8000-00000000c0NN` — a fixed, valid UUIDv7. */
const templateId = (n: number): string =>
  `0192f0c0-0000-7000-8000-00000000c0${String(n).padStart(2, '0')}`;
/** A seeded template stage's id: template n, stage s. */
export const seedStageId = (n: number, s: number): string =>
  `0192f0c0-0000-7000-8000-0000000c${String(n).padStart(2, '0')}${String(s).padStart(2, '0')}`;

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  {
    id: templateId(1),
    name: 'Hackathon',
    eventType: 'HACKATHON',
    description: 'From forming the team to the demo and the wrap-up.',
    stages: [
      {
        name: 'Team & registration',
        weight: 1,
        rule: REG(-2),
        tasks: ['Confirm the team', 'Register on the event site', 'Check eligibility rules'],
      },
      {
        name: 'Idea & problem',
        weight: 2,
        rule: START(-3),
        tasks: ['Shortlist problem statements', 'Pick one idea', 'Split the work'],
      },
      {
        name: 'Build prototype',
        weight: 4,
        rule: SUB(0),
        tasks: ['Set up the repository', 'Build the core feature', 'Test end to end'],
      },
      {
        name: 'Submit & demo',
        weight: 2,
        rule: END(0),
        tasks: ['Record the demo video', 'Submit the project', 'Rehearse the pitch'],
      },
      { name: 'Wrap-up', weight: 1, rule: END(7), tasks: WRAP_UP },
    ],
  },
  {
    id: templateId(2),
    name: 'Ideathon',
    eventType: 'IDEATHON',
    description: 'Research, a sharp deck, and a clean submission.',
    stages: [
      {
        name: 'Registration',
        weight: 1,
        rule: REG(-1),
        tasks: ['Register the team', 'Read the brief'],
      },
      {
        name: 'Problem research',
        weight: 2,
        rule: D('IDEA_SUBMISSION', -5),
        tasks: ['Talk to two users', 'Summarise the problem', 'Check existing solutions'],
      },
      {
        name: 'Idea deck',
        weight: 3,
        rule: D('PPT', -1),
        tasks: ['Draft the deck', 'Get feedback from a mentor', 'Finalise the slides'],
      },
      {
        name: 'Submission',
        weight: 2,
        rule: SUB(0),
        tasks: ['Submit the deck', 'Confirm receipt'],
      },
      { name: 'Wrap-up', weight: 1, rule: END(7), tasks: WRAP_UP },
    ],
  },
  {
    id: templateId(3),
    name: 'Innovation challenge',
    eventType: 'INNOVATION_CHALLENGE',
    description: 'Abstract, prototype and final submission, each on its own date.',
    stages: [
      {
        name: 'Registration',
        weight: 1,
        rule: REG(-2),
        tasks: ['Register the team', 'Read the rules'],
      },
      {
        name: 'Abstract',
        weight: 2,
        rule: D('ABSTRACT', -1),
        tasks: ['Write the abstract', 'Review with a mentor', 'Submit the abstract'],
      },
      {
        name: 'Prototype',
        weight: 4,
        rule: D('PROTOTYPE', -1),
        tasks: ['Build the prototype', 'Test with users', 'Document the design'],
      },
      {
        name: 'Final submission',
        weight: 2,
        rule: D('FINAL_SUBMISSION', 0),
        tasks: ['Prepare the report', 'Submit everything'],
      },
      { name: 'Wrap-up', weight: 1, rule: END(7), tasks: WRAP_UP },
    ],
  },
  {
    id: templateId(4),
    name: 'CTF',
    eventType: 'CTF',
    description: 'Practice, compete, and write it up.',
    stages: [
      {
        name: 'Registration',
        weight: 1,
        rule: REG(-1),
        tasks: ['Register the team', 'Join the event chat'],
      },
      {
        name: 'Practice & tooling',
        weight: 2,
        rule: START(-2),
        tasks: [
          'Set up the tool kit',
          'Solve two past challenges',
          'Agree who takes which category',
        ],
      },
      {
        name: 'Compete',
        weight: 4,
        rule: START(0),
        tasks: ['Check in', 'Log every flag', 'Share progress hourly'],
      },
      {
        name: 'Write-ups',
        weight: 1,
        rule: END(3),
        tasks: ['Write up the solved challenges', 'Publish the write-ups'],
      },
      { name: 'Wrap-up', weight: 1, rule: END(7), tasks: WRAP_UP },
    ],
  },
  {
    id: templateId(5),
    name: 'Coding contest',
    eventType: 'CODING_CONTEST',
    description: 'Practise, compete, then upsolve.',
    stages: [
      {
        name: 'Registration',
        weight: 1,
        rule: REG(-1),
        tasks: ['Register', 'Check the contest rules'],
      },
      {
        name: 'Practice set',
        weight: 3,
        rule: START(-3),
        tasks: ['Solve a practice set', 'Review weak topics'],
      },
      { name: 'Contest day', weight: 3, rule: START(0), tasks: ['Check in on time', 'Compete'] },
      {
        name: 'Upsolve & review',
        weight: 1,
        rule: END(3),
        tasks: ['Upsolve two problems', 'Note what to practise next'],
      },
    ],
  },
];
