export const STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'closed', 'dropped'];
export const NEW = '__new__';

export const NAV = [
  { key: 'dashboard',  label: 'Dashboard',              icon: 'chart' },
  { key: 'leads',      label: 'Leads',                  icon: 'users' },
  { key: 'tickets',    label: 'Support tickets',        icon: 'ticket' },
  { key: 'forms',      label: 'Lead forms',             icon: 'code' },
  { key: 'ingest',     label: 'Ingest log',             icon: 'inbox' },
  { key: 'settings',   label: 'Settings',               icon: 'settings' },
  { key: 'help',       label: 'Help Center',            icon: 'help-circle' },
];

export const DEAL_STAGES = ['negotiation', 'booked', 'closed_won', 'closed_lost'];
export const DEAL_STAGE_LABELS = { negotiation: 'Negotiation', booked: 'Booked', closed_won: 'Closed won', closed_lost: 'Closed lost' };
export const DEAL_ELIGIBLE_STATUSES = ['negotiation', 'closed'];
