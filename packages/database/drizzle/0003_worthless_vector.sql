CREATE TABLE "guest_affiliations" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(7) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_affiliations_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "guest_affiliations_color_check" CHECK ("guest_affiliations"."color" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "guest_affiliations_sort_order_check" CHECK ("guest_affiliations"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "affiliation_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_affiliations" ADD CONSTRAINT "guest_affiliations_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_affiliations_wedding_name_unique" ON "guest_affiliations" USING btree ("wedding_id",lower("name"));--> statement-breakpoint
CREATE INDEX "guest_affiliations_wedding_order_idx" ON "guest_affiliations" USING btree ("wedding_id","sort_order","id");--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_affiliation_scope_fk" FOREIGN KEY ("wedding_id","affiliation_id") REFERENCES "public"."guest_affiliations"("wedding_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_wedding_affiliation_idx" ON "guests" USING btree ("wedding_id","affiliation_id") WHERE "guests"."affiliation_id" is not null;