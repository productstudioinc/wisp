ALTER TABLE "projects" ALTER COLUMN "last_updated" SET DATA TYPE time with time zone;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "created_at" SET DATA TYPE time with time zone;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "deployed_at" SET DATA TYPE time with time zone;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "deployed_at" SET DEFAULT now();