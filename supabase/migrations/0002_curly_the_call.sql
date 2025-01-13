DROP TABLE "project_logs" CASCADE;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status_message" text;