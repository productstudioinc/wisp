ALTER TABLE "projects" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "deleted_at";