import { pgTable, text, uuid, timestamp, varchar, jsonb, pgEnum, index, boolean } from "drizzle-orm/pg-core";

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
  lastUpdated: timestamp('last_updated').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
  error: text('error'),
  deployedAt: timestamp('deployed_at'),
  private: boolean('private').notNull().default(false),
}, (table) => {
  return {
    userIdIdx: index('user_id_idx').on(table.userId)
  }
});
