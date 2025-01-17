CREATE TYPE "public"."project_status" AS ENUM('creating', 'deploying', 'deployed', 'failed', 'deleted');--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"dns_record_id" text,
	"custom_domain" text,
	"prompt" text,
	"status" "project_status" DEFAULT 'creating' NOT NULL,
	"status_message" text,
	"last_updated" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"error" text,
	"deployed_at" timestamp with time zone,
	"private" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"email" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "projects" USING btree ("user_id");