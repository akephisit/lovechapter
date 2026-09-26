CREATE TABLE "envelope_print_templates" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"width_mm" integer NOT NULL,
	"height_mm" integer NOT NULL,
	"orientation" varchar(9) NOT NULL,
	"margin_top_mm" integer NOT NULL,
	"margin_right_mm" integer NOT NULL,
	"margin_bottom_mm" integer NOT NULL,
	"margin_left_mm" integer NOT NULL,
	"alignment" varchar(6) NOT NULL,
	"font_family" varchar(16) NOT NULL,
	"font_size_pt" integer NOT NULL,
	"line_spacing_percent" integer NOT NULL,
	"show_address" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "envelope_print_templates_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "envelope_print_templates_dimensions_check" CHECK ("envelope_print_templates"."width_mm" between 90 and 330 and "envelope_print_templates"."height_mm" between 55 and 480),
	CONSTRAINT "envelope_print_templates_margins_check" CHECK ("envelope_print_templates"."margin_top_mm" >= 0 and "envelope_print_templates"."margin_right_mm" >= 0 and "envelope_print_templates"."margin_bottom_mm" >= 0 and "envelope_print_templates"."margin_left_mm" >= 0 and "envelope_print_templates"."width_mm" - "envelope_print_templates"."margin_left_mm" - "envelope_print_templates"."margin_right_mm" >= 20 and "envelope_print_templates"."height_mm" - "envelope_print_templates"."margin_top_mm" - "envelope_print_templates"."margin_bottom_mm" >= 20),
	CONSTRAINT "envelope_print_templates_orientation_check" CHECK ("envelope_print_templates"."orientation" in ('landscape', 'portrait') and "envelope_print_templates"."alignment" in ('left', 'center', 'right')),
	CONSTRAINT "envelope_print_templates_font_check" CHECK ("envelope_print_templates"."font_family" in ('noto-sans-thai', 'noto-serif-thai') and "envelope_print_templates"."font_size_pt" between 8 and 72 and "envelope_print_templates"."line_spacing_percent" between 80 and 250),
	CONSTRAINT "envelope_print_templates_name_check" CHECK (length(trim("envelope_print_templates"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "envelope_print_templates" ADD CONSTRAINT "envelope_print_templates_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "envelope_print_templates_name_unique" ON "envelope_print_templates" USING btree ("wedding_id",lower("name"));--> statement-breakpoint
CREATE INDEX "envelope_print_templates_order_idx" ON "envelope_print_templates" USING btree ("wedding_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);