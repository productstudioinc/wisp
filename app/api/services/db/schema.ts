import { pgTable, text, uuid, pgEnum, index, boolean, time } from "drizzle-orm/pg-core";

export const projectStatus = pgEnum('project_status', ['creating', 'deploying', 'deployed', 'failed', 'deleted']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().notNull(),
  fullName: text('full_name'),
  email: text('email').notNull().unique(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().notNull(),
  name: text('name').notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: text('project_id').notNull(),
  dnsRecordId: text('dns_record_id'),
  customDomain: text('custom_domain'),
  prompt: text('prompt'),
  status: projectStatus('status').notNull().default('creating'),
  statusMessage: text('status_message'),
  lastUpdated: time('last_updated', { withTimezone: true }).defaultNow(),
  createdAt: time('created_at', { withTimezone: true }).defaultNow(),
  error: text('error'),
  deployedAt: time('deployed_at', { withTimezone: true }).defaultNow(),
  private: boolean('private').notNull().default(false),
}, (table) => {
  return {
    userIdIdx: index('user_id_idx').on(table.userId)
  }
});
