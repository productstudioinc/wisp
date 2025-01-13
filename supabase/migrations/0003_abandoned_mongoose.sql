ALTER TABLE "projects" ADD COLUMN "last_updated" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deployed_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "metadata";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "updated_at";