CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"last_name" text,
	"email" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
