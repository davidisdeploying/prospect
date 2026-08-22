// Prospect — sample claim data for the UI kit (fake, illustrative)
window.PROSPECT_DATA = {
  stages: [
    { key: 'Showings', gloss: 'Saved', },
    { key: 'Staked', gloss: 'Applied' },
    { key: 'Working the Vein', gloss: 'Interviewing', short: 'Vein' },
    { key: 'Strike', gloss: 'Offer' },
  ],
  claims: [
    { id: 'CLM-0042', role: 'Senior Backend Eng', company: 'Northvale Robotics', stage: 'Showings', meta: '$180–210k · remote', tags: ['remote', '$180–210k'] },
    { id: 'CLM-0043', role: 'Platform Engineer', company: 'Atlas Data', stage: 'Showings', meta: '$165–195k · hybrid', tags: ['hybrid'] },
    { id: 'CLM-0044', role: 'Backend Engineer', company: 'Quarry Logistics', stage: 'Showings', meta: '$160–180k · onsite' },
    { id: 'CLM-0045', role: 'Infra Engineer', company: 'Cobalt Systems', stage: 'Staked', meta: 'staked 3d ago', tags: ['$170k'] },
    { id: 'CLM-0046', role: 'SRE', company: 'Meridian Health', stage: 'Staked', meta: 'staked 1w ago' },
    { id: 'CLM-0048', role: 'Full-Stack Eng', company: 'Tidewater Labs', stage: 'Working the Vein', meta: 'screen · Thu 2pm' },
    { id: 'CLM-0047', role: 'Senior Backend Engineer', company: 'Granite Map Co.', stage: 'Working the Vein', meta: 'onsite · Jun 26',
      comp: '$185k – $215k + 0.05%', source: 'Referral · Dana R.', next: 'Onsite loop — Jun 26, 11:00',
      contacts: 'Dana R. (recruiter) · Sam K. (hiring mgr)', remote: 'Remote (US)',
      samples: 'Hiring manager is ex-Stripe infra. Take-home was a queue design — went well. Team owns the routing layer; growing fast. Ask about on-call rotation.' },
    { id: 'CLM-0049', role: 'Senior Engineer', company: 'Lumen Foundry', stage: 'Strike', meta: 'offer · $205k', strike: true,
      comp: '$205k + 0.08%', source: 'Cold apply', next: 'Decision by Jul 1' },
  ],
  metrics: [
    { k: 'Claims staked', v: '18', sub: '+5 this week' },
    { k: 'Response rate', v: '50%', sub: 'replied after applying' },
    { k: 'Strikes', v: '1', sub: 'offer in hand', hi: true },
    { k: 'Active veins', v: '4', sub: 'live loops' },
    { k: 'Median response', v: '6d', sub: 'staked → reply' },
    { k: 'Tailings', v: '13', sub: 'closed / passed' },
  ],
};
