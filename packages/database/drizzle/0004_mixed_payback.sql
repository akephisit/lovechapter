CREATE TABLE "guest_postal_addresses" (
	"wedding_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"address_line_1" varchar(180) NOT NULL,
	"address_line_2" varchar(180),
	"locality" varchar(120),
	"administrative_area" varchar(120),
	"postal_code" varchar(32),
	"country_code" varchar(2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_postal_addresses_pkey" PRIMARY KEY("wedding_id","guest_id"),
	CONSTRAINT "guest_postal_addresses_country_code_check" CHECK (country_code is null or country_code ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
DROP INDEX "guests_wedding_created_idx";--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "phone" varchar(40);--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "envelope_name" varchar(180);--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "note" varchar(2000);--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_postal_addresses" ADD CONSTRAINT "guest_postal_addresses_guest_scope_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_wedding_active_created_idx" ON "guests" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "guests"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "guests_wedding_archived_created_idx" ON "guests" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "guests"."archived_at" is not null;