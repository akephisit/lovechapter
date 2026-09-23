CREATE TABLE "budget_categories" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "budget_categories_name_nonblank" CHECK (length(trim("budget_categories"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_configs" (
	"wedding_id" uuid PRIMARY KEY NOT NULL,
	"currency" varchar(3) NOT NULL,
	"target_minor" bigint,
	CONSTRAINT "budget_configs_currency_check" CHECK ("budget_configs"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "budget_configs_target_check" CHECK ("budget_configs"."target_minor" between 0 and 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"title" varchar(180) NOT NULL,
	"planned_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"category_id" uuid,
	"vendor_id" uuid,
	"due_date" date,
	"note" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "expenses_amounts_check" CHECK ("expenses"."planned_minor" between 0 and 1000000000000 and "expenses"."paid_minor" between 0 and "expenses"."planned_minor"),
	CONSTRAINT "expenses_title_nonblank" CHECK (length(trim("expenses"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "run_sheet_items" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"title" varchar(180) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" varchar(180),
	"responsible" varchar(120),
	"note" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_sheet_items_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "run_sheet_items_time_check" CHECK ("run_sheet_items"."ends_at" > "run_sheet_items"."starts_at"),
	CONSTRAINT "run_sheet_items_title_nonblank" CHECK (length(trim("run_sheet_items"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "seating_assignments" (
	"wedding_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	CONSTRAINT "seating_assignments_pkey" PRIMARY KEY("wedding_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "seating_tables" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"capacity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seating_tables_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "seating_tables_capacity_check" CHECK ("seating_tables"."capacity" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"status" varchar(16) NOT NULL,
	"contact_name" varchar(120),
	"email" varchar(320),
	"phone" varchar(40),
	"quote_minor" bigint,
	"note" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "vendors_status_check" CHECK ("vendors"."status" in ('researching','contacted','booked','cancelled')),
	CONSTRAINT "vendors_quote_check" CHECK ("vendors"."quote_minor" between 0 and 1000000000000),
	CONSTRAINT "vendors_name_nonblank" CHECK (length(trim("vendors"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_configs" ADD CONSTRAINT "budget_configs_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_scope_fk" FOREIGN KEY ("wedding_id","category_id") REFERENCES "public"."budget_categories"("wedding_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_vendor_scope_fk" FOREIGN KEY ("wedding_id","vendor_id") REFERENCES "public"."vendors"("wedding_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheet_items" ADD CONSTRAINT "run_sheet_items_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_guest_scope_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_assignments" ADD CONSTRAINT "seating_assignments_table_scope_fk" FOREIGN KEY ("wedding_id","table_id") REFERENCES "public"."seating_tables"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seating_tables" ADD CONSTRAINT "seating_tables_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_name_unique" ON "budget_categories" USING btree ("wedding_id",lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_wedding_created_idx" ON "expenses" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "expenses_wedding_category_idx" ON "expenses" USING btree ("wedding_id","category_id") WHERE "expenses"."category_id" is not null;--> statement-breakpoint
CREATE INDEX "expenses_wedding_vendor_idx" ON "expenses" USING btree ("wedding_id","vendor_id") WHERE "expenses"."vendor_id" is not null;--> statement-breakpoint
CREATE INDEX "run_sheet_items_wedding_start_idx" ON "run_sheet_items" USING btree ("wedding_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "seating_assignments_table_idx" ON "seating_assignments" USING btree ("wedding_id","table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seating_tables_name_unique" ON "seating_tables" USING btree ("wedding_id",lower("name"));--> statement-breakpoint
CREATE INDEX "vendors_wedding_created_idx" ON "vendors" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);