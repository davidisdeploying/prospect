// The prospector's funnel — mining stage name paired with its plain-meaning gloss.
export const FUNNEL_STAGES = [
  { key: 'Showings', gloss: 'Saved' },
  { key: 'Staked', gloss: 'Applied' },
  { key: 'Working the Vein', gloss: 'Interviewing' },
  { key: 'Strike', gloss: 'Offer' },
];

export const TAILINGS_STAGE = { key: 'Tailings', gloss: 'Rejected / withdrawn' };

export const ALL_STAGES = [...FUNNEL_STAGES, TAILINGS_STAGE];
