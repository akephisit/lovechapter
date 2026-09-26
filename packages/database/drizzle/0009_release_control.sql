CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."release_control" (
	"id" integer PRIMARY KEY NOT NULL,
	"mode" varchar(16) NOT NULL,
	"target_sha" varchar(40),
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_control_singleton_chk" CHECK ("ops"."release_control"."id" = 1),
	CONSTRAINT "release_control_mode_chk" CHECK ("ops"."release_control"."mode" in ('open', 'maintenance')),
	CONSTRAINT "release_control_target_sha_chk" CHECK ("ops"."release_control"."target_sha" is null or "ops"."release_control"."target_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "ops"."release_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(16) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_leases_kind_chk" CHECK ("ops"."release_leases"."kind" in ('http', 'email', 'cleanup'))
);
--> statement-breakpoint
INSERT INTO "ops"."release_control" ("id", "mode") VALUES (1, 'open');
