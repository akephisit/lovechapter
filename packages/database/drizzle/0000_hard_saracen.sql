CREATE TYPE "public"."attendance_status" AS ENUM('attending', 'declined');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'couple', 'planner', 'collaborator');--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(320),
	"allowed_party_size" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_pkey" PRIMARY KEY("wedding_id","id"),
	CONSTRAINT "guests_allowed_party_size_check" CHECK ("guests"."allowed_party_size" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wedding_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wedding_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"attendance" "attendance_status" NOT NULL,
	"party_size" integer NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvps_party_size_check" CHECK (("rsvps"."attendance" = 'attending' and "rsvps"."party_size" between 1 and 20) or ("rsvps"."attendance" = 'declined' and "rsvps"."party_size" = 0))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_provider" varchar(64) NOT NULL,
	"auth_subject" varchar(255) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wedding_members" (
	"wedding_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wedding_members_pkey" PRIMARY KEY("wedding_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "weddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"wedding_date" date,
	"time_zone" varchar(64) NOT NULL,
	"locale" varchar(35) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"workspace_owner_user_id" uuid NOT NULL,
	"billing_owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_guest_scope_fk" FOREIGN KEY ("wedding_id","guest_id") REFERENCES "public"."guests"("wedding_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_wedding_guest_id_unique" ON "invitations" USING btree ("wedding_id","guest_id","id");--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_invitation_scope_fk" FOREIGN KEY ("wedding_id","guest_id","invitation_id") REFERENCES "public"."invitations"("wedding_id","guest_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_members" ADD CONSTRAINT "wedding_members_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_members" ADD CONSTRAINT "wedding_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_workspace_owner_user_id_users_id_fk" FOREIGN KEY ("workspace_owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_billing_owner_user_id_users_id_fk" FOREIGN KEY ("billing_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_wedding_created_idx" ON "guests" USING btree ("wedding_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_active_per_guest" ON "invitations" USING btree ("wedding_id","guest_id") WHERE "invitations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "invitations_creator_idx" ON "invitations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rsvps_wedding_guest_unique" ON "rsvps" USING btree ("wedding_id","guest_id");--> statement-breakpoint
CREATE INDEX "rsvps_invitation_idx" ON "rsvps" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" USING btree ("auth_provider","auth_subject");--> statement-breakpoint
CREATE INDEX "wedding_members_user_created_idx" ON "wedding_members" USING btree ("user_id","created_at" DESC NULLS LAST,"wedding_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "weddings_owner_idx" ON "weddings" USING btree ("workspace_owner_user_id");--> statement-breakpoint
CREATE INDEX "weddings_creator_idx" ON "weddings" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "weddings_billing_owner_idx" ON "weddings" USING btree ("billing_owner_user_id");
