CREATE TYPE "public"."auth_token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_key" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_credential_version_check" CHECK ("auth_accounts"."credential_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_email_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "auth_token_purpose" NOT NULL,
	"account_id" uuid NOT NULL,
	"auth_token_id" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"leased_until" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_email_jobs_attempt_count_check" CHECK ("auth_email_jobs"."attempt_count" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"scope" varchar(64) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"bucket_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY("scope","key_hash","bucket_started_at"),
	CONSTRAINT "auth_rate_limits_count_check" CHECK ("auth_rate_limits"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_expiry_order_check" CHECK ("auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "auth_token_purpose" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"signing_key_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_signing_key_version_check" CHECK ("auth_tokens"."signing_key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_email_jobs" ADD CONSTRAINT "auth_email_jobs_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_email_jobs" ADD CONSTRAINT "auth_email_jobs_auth_token_id_auth_tokens_id_fk" FOREIGN KEY ("auth_token_id") REFERENCES "public"."auth_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_email_key_unique" ON "auth_accounts" USING btree ("email_key");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_email_jobs_idempotency_key_unique" ON "auth_email_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "auth_email_jobs_due_idx" ON "auth_email_jobs" USING btree ("available_at","id") WHERE "auth_email_jobs"."sent_at" is null and "auth_email_jobs"."attempt_count" < 10;--> statement-breakpoint
CREATE INDEX "auth_rate_limits_expiry_cleanup_idx" ON "auth_rate_limits" USING btree ("expires_at","scope","key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_unique" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_active_idx" ON "auth_sessions" USING btree ("account_id") WHERE "auth_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "auth_sessions_active_expiry_idx" ON "auth_sessions" USING btree ("idle_expires_at","absolute_expires_at","id") WHERE "auth_sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "auth_sessions_revoked_cleanup_idx" ON "auth_sessions" USING btree ("revoked_at","id") WHERE "auth_sessions"."revoked_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_account_purpose_active_idx" ON "auth_tokens" USING btree ("account_id","purpose","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "auth_tokens"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "auth_tokens_expiry_cleanup_idx" ON "auth_tokens" USING btree ("expires_at","id");