CREATE TABLE "planning_tasks" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"title" varchar(180) NOT NULL,
	"category" varchar(80),
	"note" varchar(2000),
	"due_date" date,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_tasks_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "planning_tasks_title_nonblank" CHECK (length(trim("planning_tasks"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "planning_tasks" ADD CONSTRAINT "planning_tasks_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planning_tasks_wedding_created_idx" ON "planning_tasks" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "planning_tasks_open_due_idx" ON "planning_tasks" USING btree ("wedding_id","due_date","id") WHERE "planning_tasks"."completed_at" is null and "planning_tasks"."due_date" is not null;