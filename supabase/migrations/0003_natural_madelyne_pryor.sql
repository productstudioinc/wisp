ALTER TABLE "projects" RENAME COLUMN "prompt" TO "description";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "display_name" text;