ALTER TABLE "ops"."release_control" ADD COLUMN "web_version_id" varchar(128);--> statement-breakpoint
ALTER TABLE "ops"."release_control" ADD COLUMN "web_source_sha" varchar(40);--> statement-breakpoint
ALTER TABLE "ops"."release_control" ADD COLUMN "api_version_id" varchar(128);--> statement-breakpoint
ALTER TABLE "ops"."release_control" ADD COLUMN "api_source_sha" varchar(40);--> statement-breakpoint
ALTER TABLE "ops"."release_control" ADD CONSTRAINT "release_control_versions_chk" CHECK ((
        "ops"."release_control"."web_version_id" is null and "ops"."release_control"."web_source_sha" is null and
        "ops"."release_control"."api_version_id" is null and "ops"."release_control"."api_source_sha" is null
      ) or (
        "ops"."release_control"."target_sha" is not null and
        "ops"."release_control"."web_version_id" is not null and length("ops"."release_control"."web_version_id") > 0 and
        "ops"."release_control"."web_source_sha" is not null and "ops"."release_control"."web_source_sha" ~ '^[0-9a-f]{40}$' and
        "ops"."release_control"."api_version_id" is not null and length("ops"."release_control"."api_version_id") > 0 and
        "ops"."release_control"."api_source_sha" is not null and "ops"."release_control"."api_source_sha" ~ '^[0-9a-f]{40}$'
      ));
