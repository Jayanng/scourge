import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const matches = pgTable(
  'matches',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().default('unknown'),
    homeTeam: text('home_team').notNull(),
    awayTeam: text('away_team').notNull(),
    kickoffAt: timestamp('kickoff_at', { withTimezone: true }),
    status: text('status').notNull().default('scheduled'),
    minute: integer('minute'),
    homeScore: integer('home_score').default(0),
    awayScore: integer('away_score').default(0),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('matches_id_idx').on(t.id)],
);

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matches.id),
  type: text('type').notNull(),
  minute: integer('minute').notNull(),
  player: text('player'),
  teamId: text('team_id'),
  extra: jsonb('extra'),
  source: text('source').notNull().default('live'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const markets = pgTable('markets', {
  id: serial('id').primaryKey(),
  contractAddress: text('contract_address'),
  matchId: text('match_id').references(() => matches.id),
  template: text('template').notNull(),
  question: text('question').notNull(),
  closesAt: integer('closes_at'),
  status: text('status').notNull().default('open'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const agentActions = pgTable('agent_actions', {
  id: serial('id').primaryKey(),
  agent: text('agent').notNull(),
  action: text('action').notNull(),
  matchId: text('match_id'),
  marketId: text('market_id'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
