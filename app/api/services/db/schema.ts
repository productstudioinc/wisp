import { pgTable, text, uuid, pgEnum, index, boolean, timestamp } from "drizzle-orm/pg-core";

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
  vercelProjectId: text('vercel_project_id').notNull(),
  dnsRecordId: text('dns_record_id'),
  customDomain: text('custom_domain'),
  description: text('description'),
  displayName: text('display_name'),
  status: projectStatus('status').notNull().default('creating'),
  statusMessage: text('status_message'),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  error: text('error'),
  deployedAt: timestamp('deployed_at', { withTimezone: true }),
  private: boolean('private').notNull().default(false),
  mobileScreenshot: text('mobile_screenshot'),
}, (table) => {
  return {
    userIdIdx: index('user_id_idx').on(table.userId)
  }
});
