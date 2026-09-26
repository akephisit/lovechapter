CREATE TYPE "public"."guest_import_status" AS ENUM('previewed', 'committed');--> statement-breakpoint
CREATE TABLE "guest_import_batches" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"source_sha256" varchar(64) NOT NULL,
	"headers" jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"affiliation_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "guest_import_status" DEFAULT 'previewed' NOT NULL,
	"preview_version" integer DEFAULT 1 NOT NULL,
	"row_count" integer NOT NULL,
	"valid_count" integer NOT NULL,
	"warning_count" integer NOT NULL,
	"invalid_count" integer NOT NULL,
	"excluded_count" integer NOT NULL,
	"commit_idempotency_key" varchar(128),
	"commit_result" jsonb,
	"committed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_import_batches_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "guest_import_batches_sha_check" CHECK ("guest_import_batches"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "guest_import_batches_version_check" CHECK ("guest_import_batches"."preview_version" > 0),
	CONSTRAINT "guest_import_batches_counts_check" CHECK ("guest_import_batches"."row_count" between 0 and 5000 and "guest_import_batches"."valid_count" >= 0 and "guest_import_batches"."warning_count" >= 0 and "guest_import_batches"."invalid_count" >= 0 and "guest_import_batches"."excluded_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guest_import_rows" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_values" jsonb NOT NULL,
	"candidate" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	CONSTRAINT "guest_import_rows_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "guest_import_rows_number_check" CHECK ("guest_import_rows"."row_number" >= 2)
);
--> statement-breakpoint
ALTER TABLE "guest_import_batches" ADD CONSTRAINT "guest_import_batches_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_import_batches" ADD CONSTRAINT "guest_import_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_import_rows" ADD CONSTRAINT "guest_import_rows_batch_scope_fk" FOREIGN KEY ("wedding_id","batch_id") REFERENCES "public"."guest_import_batches"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_import_batches_cleanup_idx" ON "guest_import_batches" USING btree ("status","expires_at","wedding_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_import_rows_number_unique" ON "guest_import_rows" USING btree ("wedding_id","batch_id","row_number");--> statement-breakpoint
CREATE INDEX "guest_import_rows_preview_idx" ON "guest_import_rows" USING btree ("wedding_id","batch_id","row_number","id");