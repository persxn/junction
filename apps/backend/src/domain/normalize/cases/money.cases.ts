import type { NormalizeCase } from './case.js';

/**
 * Fees, prizes and team sizes (§7.3).
 *
 * The line these cases defend: **free is a price and unknown is not.** A
 * professor budgeting for a team needs "₹0" and "we could not tell" to look
 * different, and currencies are never converted — two currencies in one string
 * means the fee is unknown, both are kept as text, and nobody invents a rate.
 */

export const MONEY_CASES: readonly NormalizeCase[] = [
  // ---- Fees: known zero ----------------------------------------------------
  {
    name: '"Free" is a known fee of zero',
    input: { feeText: 'Free' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 0, 'fee.currency': 'INR' } },
  },
  {
    name: '"₹0" is a known fee of zero',
    input: { feeText: '₹0' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 0, 'fee.currency': 'INR' } },
  },
  {
    name: '"No registration fee" is a known fee of zero',
    input: { feeText: 'No registration fee' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 0 } },
  },
  {
    name: '"Free of charge" is a known fee of zero',
    input: { feeText: 'Entry is free of charge for all students' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 0 } },
  },
  {
    name: '"Nil" is a known fee of zero',
    input: { feeText: 'Fee: Nil' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 0 } },
  },

  // ---- Fees: a real amount -------------------------------------------------
  {
    name: '"₹500 per team" is 50000 minor INR and keeps the wording',
    input: { feeText: '₹500 per team' },
    expect: {
      fields: {
        'fee.known': true,
        'fee.minor': 50_000,
        'fee.currency': 'INR',
        'fee.text': '₹500 per team',
      },
    },
  },
  {
    name: '"Rs. 1,200" parses with the comma',
    input: { feeText: 'Rs. 1,200' },
    expect: { fields: { 'fee.minor': 120_000, 'fee.currency': 'INR' } },
  },
  {
    name: 'Indian digit grouping parses: "₹1,00,000"',
    input: { feeText: '₹1,00,000' },
    expect: { fields: { 'fee.minor': 10_000_000, 'fee.currency': 'INR' } },
  },
  {
    name: 'a trailing currency code parses: "250 INR"',
    input: { feeText: '250 INR' },
    expect: { fields: { 'fee.minor': 25_000, 'fee.currency': 'INR' } },
  },
  {
    name: 'dollars stay dollars',
    input: { feeText: '$10 entry fee' },
    expect: { fields: { 'fee.minor': 1_000, 'fee.currency': 'USD' } },
  },
  {
    name: 'euros stay euros',
    input: { feeText: '€25' },
    expect: { fields: { 'fee.minor': 2_500, 'fee.currency': 'EUR' } },
  },
  {
    name: 'a decimal amount keeps its paise',
    input: { feeText: '₹499.50' },
    expect: { fields: { 'fee.minor': 49_950 } },
  },

  // ---- Fees: refusals ------------------------------------------------------
  {
    name: 'a fee quoted in two currencies is unknown, both kept, never converted',
    input: { feeText: '₹500 / $10' },
    expect: {
      warnings: ['FEE_AMBIGUOUS_CURRENCY'],
      fields: { 'fee.known': false, 'fee.text': '₹500 / $10' },
      // No amount and no currency were chosen.
      lessThan: { 'fee.confidence': 0.01 },
    },
  },
  {
    name: 'several amounts in one currency are not summed or picked from',
    input: { feeText: '₹300 per head, ₹1000 per team' },
    expect: { warnings: ['FEE_UNPARSEABLE'], fields: { 'fee.known': false } },
  },
  {
    name: '"Free for IIT students, ₹500 otherwise" is not free',
    input: { feeText: 'Free for IIT students, ₹500 otherwise' },
    expect: { fields: { 'fee.known': true, 'fee.minor': 50_000 } },
  },
  {
    name: 'a fee string no pattern matches keeps the text and warns',
    input: { feeText: 'Fee as per institute norms' },
    expect: { warnings: ['FEE_UNPARSEABLE'], fields: { 'fee.known': false } },
  },
  {
    name: 'no fee text at all leaves the field absent',
    input: {},
    expect: { absent: ['fee'], noWarnings: ['FEE_UNPARSEABLE'] },
  },

  // ---- Prizes --------------------------------------------------------------
  {
    name: 'a single prize amount becomes a total',
    input: { prizeText: 'Prize pool: ₹1,00,000' },
    expect: { fields: { 'prize.totalMinor': 10_000_000, 'prize.currency': 'INR' } },
  },
  {
    name: 'a prize table is kept as text with no invented total',
    input: { prizeText: '1st ₹50,000 · 2nd ₹25,000 · 3rd ₹10,000' },
    expect: {
      // Adding them up would state a pool no source stated.
      fields: {
        'prize.text': '1st ₹50,000 · 2nd ₹25,000 · 3rd ₹10,000',
        'prize.totalMinor': undefined,
      },
    },
  },
  {
    name: 'a prize with no amount is text only',
    input: { prizeText: 'Internship offers and goodies' },
    expect: { fields: { 'prize.text': 'Internship offers and goodies' } },
  },

  // ---- Team size -----------------------------------------------------------
  {
    name: '"1-4" is a range',
    input: { teamSizeText: 'Team size: 1-4' },
    expect: { fields: { 'teamSize.min': 1, 'teamSize.max': 4 } },
  },
  {
    name: '"2 to 5 members" is a range',
    input: { teamSizeText: '2 to 5 members' },
    expect: { fields: { 'teamSize.min': 2, 'teamSize.max': 5 } },
  },
  {
    name: '"between 2 and 5" is a range',
    input: { teamSizeText: 'Teams of between 2 and 5 people' },
    expect: { fields: { 'teamSize.min': 2, 'teamSize.max': 5 } },
  },
  {
    name: '"up to 4" gives a maximum and no minimum',
    input: { teamSizeText: 'Teams of up to 4' },
    expect: { fields: { 'teamSize.max': 4, 'teamSize.min': undefined } },
  },
  {
    name: '"maximum of 6" gives a maximum only',
    input: { teamSizeText: 'A maximum of 6 participants per team' },
    expect: { fields: { 'teamSize.max': 6 } },
  },
  {
    name: '"at least 2" gives a minimum only',
    input: { teamSizeText: 'At least 2 members required' },
    expect: { fields: { 'teamSize.min': 2, 'teamSize.max': undefined } },
  },
  {
    name: '"teams of 4" fixes both ends',
    input: { teamSizeText: 'Teams of 4' },
    expect: { fields: { 'teamSize.min': 4, 'teamSize.max': 4 } },
  },
  {
    name: '"4-member teams" fixes both ends',
    input: { teamSizeText: '4-member teams only' },
    expect: { fields: { 'teamSize.min': 4, 'teamSize.max': 4 } },
  },
  {
    name: '"solo or teams of 2" allows one and at most two',
    input: { teamSizeText: 'Solo or teams of 2' },
    expect: { fields: { 'teamSize.min': 1, 'teamSize.max': 2 } },
  },
  {
    name: '"individual participation only" is a team of one',
    input: { teamSizeText: 'Individual participation only' },
    expect: { fields: { 'teamSize.min': 1, 'teamSize.max': 1 } },
  },
  {
    name: 'an unreadable team-size phrase keeps the text and warns',
    input: { teamSizeText: 'Team size as decided by the organisers' },
    expect: {
      warnings: ['TEAM_SIZE_UNPARSEABLE'],
      fields: { 'teamSize.min': undefined, 'teamSize.max': undefined },
    },
  },
  {
    name: 'an implausible team size is refused rather than stored',
    input: { teamSizeText: 'Teams of 400' },
    expect: { warnings: ['TEAM_SIZE_UNPARSEABLE'], fields: { 'teamSize.max': undefined } },
  },
  {
    name: 'no team-size text leaves the field absent',
    input: {},
    expect: { absent: ['teamSize'], noWarnings: ['TEAM_SIZE_UNPARSEABLE'] },
  },
];
