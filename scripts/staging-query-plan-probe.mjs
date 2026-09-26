import { createHash, randomUUID } from "node:crypto";
import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { URL } from "node:url";

import pg from "pg";

export async function runQueryPlanProbe(
  {
    testDatabaseUrl,
    activeStagingHost,
    productionHost,
    expectedTestBranchId,
    confirm,
  },
  clientFactory,
  neonInventory,
) {
  let url;
  try {
    url = new URL(testDatabaseUrl);
  } catch {
    throw new Error("Disposable test database URL is invalid");
  }
  if (
    confirm !== "lovechapter_test" ||
    !activeStagingHost ||
    !expectedTestBranchId ||
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.hostname === activeStagingHost ||
    (productionHost && url.hostname === productionHost) ||
    /(?:^|[-.])(?:pooler|pgbouncer)(?:[.-]|$)/iu.test(url.hostname) ||
    [...url.searchParams.keys()].some(
      (name) => name !== "sslmode" && name !== "channel_binding",
    ) ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    !["require", "verify-full"].includes(url.searchParams.get("sslmode"))
  ) {
    throw new Error(
      "Query plans require a confirmed isolated direct TLS branch",
    );
  }
  const inventory = await neonInventory(expectedTestBranchId);
  if (
    !Array.isArray(inventory?.endpoints) ||
    inventory.endpoints.filter(
      (endpoint) =>
        endpoint.branch_id === expectedTestBranchId &&
        endpoint.host === url.hostname &&
        endpoint.type === "read_write",
    ).length !== 1
  ) {
    throw new Error(
      "Disposable database URL does not match the selected Neon branch",
    );
  }
  const client = clientFactory({
    connectionString: testDatabaseUrl,
    statement_timeout: 30_000,
  });
  const ownerId = randomUUID();
  const weddingId = randomUUID();
  const invitationId = randomUUID();
  const seed = randomUUID().slice(0, 8);
  const tokenHash = createHash("sha256").update(invitationId).digest("hex");
  let transactionOpen = false;
  const summaries = [];

  try {
    await client.connect();
    await client.query("begin");
    transactionOpen = true;
    await client.query("set local statement_timeout = '30s'");

    await client.query(
      "insert into users(id,auth_provider,auth_subject,display_name) values($1,'local',$2,'Query Plan QA')",
      [ownerId, ownerId],
    );
    await client.query(
      "insert into weddings(id,name,time_zone,locale,created_by_user_id,workspace_owner_user_id) values($1,'Plan QA','Asia/Bangkok','en',$2,$2)",
      [weddingId, ownerId],
    );
    await client.query(
      "insert into weddings(id,name,time_zone,locale,created_by_user_id,workspace_owner_user_id) select gen_random_uuid(),'Plan QA '||n,'Asia/Bangkok','en',$1,$1 from generate_series(1,999) n",
      [ownerId],
    );
    await client.query(
      "insert into wedding_members(wedding_id,user_id,role) select id,$1,'owner' from weddings where created_by_user_id=$1",
      [ownerId],
    );
    await client.query(
      "insert into guests(id,wedding_id,name,email,allowed_party_size) select gen_random_uuid(),$1,'Guest '||n,'guest-'||n||'@example.test',2 from generate_series(1,2000) n",
      [weddingId],
    );
    await client.query(
      "insert into guests(id,wedding_id,name,email,allowed_party_size) select gen_random_uuid(),w.id,'Other guest '||n,null,2 from (select id from weddings where created_by_user_id=$1 and id<>$2 order by id limit 9) w cross join generate_series(1,2000) n",
      [ownerId, weddingId],
    );
    const guestId = (
      await client.query(
        "select id from guests where wedding_id=$1 order by created_at desc,id desc limit 1",
        [weddingId],
      )
    ).rows[0].id;
    await client.query(
      "insert into invitations(id,wedding_id,guest_id,token_hash,created_by_user_id) values($1,$2,$3,$4,$5)",
      [invitationId, weddingId, guestId, tokenHash, ownerId],
    );
    await client.query(
      "insert into invitations(id,wedding_id,guest_id,token_hash,created_by_user_id) select gen_random_uuid(),g.wedding_id,g.id,md5(g.id::text)||md5(g.id::text||'invitation'),$1 from (select wedding_id,id from guests where wedding_id=$2 and id<>$3 order by id limit 999) g",
      [ownerId, weddingId, guestId],
    );
    await client.query(
      "insert into rsvps(id,wedding_id,guest_id,invitation_id,attendance,party_size) values(gen_random_uuid(),$1,$2,$3,'attending',2)",
      [weddingId, guestId, invitationId],
    );
    await client.query(
      "insert into auth_accounts(id,email,email_key,password_hash,email_verified_at) select gen_random_uuid(),'plan-auth-'||$1||'-'||n||'@example.test','plan-auth-'||$1||'-'||n||'@example.test','synthetic-hash',now() from generate_series(1,1000) n",
      [seed],
    );
    const emailPattern = `plan-auth-${seed}-%`;
    await client.query(
      "insert into auth_sessions(id,account_id,token_hash,idle_expires_at,absolute_expires_at,last_seen_at) select gen_random_uuid(),id,md5(id::text)||md5(id::text||'session'),now()+interval '1 day',now()+interval '7 days',now() from auth_accounts where email_key like $1",
      [emailPattern],
    );
    await client.query(
      "insert into auth_tokens(id,account_id,purpose,token_hash,signing_key_version,expires_at) select gen_random_uuid(),id,'verify_email',md5(id::text)||md5(id::text||'token'),1,now()+interval '1 day' from auth_accounts where email_key like $1",
      [emailPattern],
    );
    await client.query(
      "insert into auth_email_jobs(id,kind,account_id,auth_token_id,idempotency_key,available_at,sent_at) select gen_random_uuid(),'verify_email',t.account_id,t.id,'plan-'||t.id::text,now()-interval '1 minute',case when row_number() over(order by t.id)>10 then now() else null end from auth_tokens t join auth_accounts a on a.id=t.account_id where a.email_key like $1",
      [emailPattern],
    );
    await client.query(
      "insert into auth_rate_limits(scope,key_hash,bucket_started_at,count,expires_at) select 'plan-qa',md5(n::text)||md5(n::text||'bucket'),date_trunc('minute',now()),1,now()-interval '1 day' from generate_series(1,1000) n",
    );
    await client.query(
      "insert into auth_rate_limits(scope,key_hash,bucket_started_at,count,expires_at) select 'plan-qa-active',md5(n::text)||md5(n::text||'active'),date_trunc('minute',now()),1,now()+interval '1 day' from generate_series(1,9000) n",
    );

    for (const table of [
      "weddings",
      "wedding_members",
      "guests",
      "invitations",
      "rsvps",
      "auth_accounts",
      "auth_sessions",
      "auth_tokens",
      "auth_email_jobs",
      "auth_rate_limits",
    ]) {
      await client.query(`analyze ${table}`);
    }

    const account = (
      await client.query("select id from auth_accounts where email_key=$1", [
        `plan-auth-${seed}-500@example.test`,
      ])
    ).rows[0];
    const plans = [
      [
        "wedding-list",
        "select w.id,w.name,m.role from weddings w join wedding_members m on m.wedding_id=w.id and m.user_id=$1 order by m.created_at desc,m.wedding_id desc limit 51",
        [ownerId],
      ],
      [
        "guest-list",
        "with authorized_wedding as (select wedding_id from wedding_members where wedding_id=$1 and user_id=$2 limit 1) select g.id,g.name,r.attendance from authorized_wedding a left join guests g on g.wedding_id=a.wedding_id and g.archived_at is null left join rsvps r on r.wedding_id=g.wedding_id and r.guest_id=g.id order by g.created_at desc nulls last,g.id desc nulls last limit 51",
        [weddingId, ownerId],
      ],
      [
        "invitation-lookup",
        "select i.id,g.name,r.attendance from invitations i join guests g on g.wedding_id=i.wedding_id and g.id=i.guest_id left join rsvps r on r.wedding_id=g.wedding_id and r.guest_id=g.id where i.token_hash=$1 and i.revoked_at is null and (i.expires_at is null or i.expires_at>now()) limit 1",
        [tokenHash],
      ],
      [
        "auth-email-lookup",
        "select id,password_hash,email_verified_at from auth_accounts where email_key=$1 limit 1",
        [`plan-auth-${seed}-500@example.test`],
      ],
      [
        "session-lookup",
        "select s.id,a.email from auth_sessions s join auth_accounts a on a.id=s.account_id where s.token_hash=$1 and s.revoked_at is null and s.idle_expires_at>now() and s.absolute_expires_at>now() and a.email_verified_at is not null limit 1",
        [
          createHash("md5").update(account.id).digest("hex") +
            createHash("md5").update(`${account.id}session`).digest("hex"),
        ],
      ],
      [
        "due-email-jobs",
        "select id from auth_email_jobs where sent_at is null and attempt_count<8 and available_at<=now() and (leased_until is null or leased_until<=now()) order by available_at,id limit 10",
        [],
      ],
      [
        "rate-limit-cleanup",
        "select scope,key_hash,bucket_started_at from auth_rate_limits where expires_at<=now() order by expires_at,scope,key_hash limit 1000",
        [],
      ],
    ];

    for (const [name, query, params] of plans) {
      const result = await client.query(
        `explain (analyze, buffers, format json) ${query}`,
        params,
      );
      const plan = result.rows[0]["QUERY PLAN"][0];
      const nodes = [];
      const walk = (node) => {
        nodes.push([node["Node Type"], node["Index Name"] ?? null]);
        for (const child of node.Plans ?? []) walk(child);
      };
      walk(plan.Plan);
      summaries.push({
        name,
        executionMs: plan["Execution Time"],
        rootRows: plan.Plan["Actual Rows"],
        sharedHit: plan.Plan["Shared Hit Blocks"],
        sharedRead: plan.Plan["Shared Read Blocks"],
        nodes,
      });
    }
  } finally {
    try {
      if (transactionOpen) {
        await client.query("rollback");
      }
    } finally {
      await client.end();
    }
  }
  const expectedIndexes = new Map([
    ["guest-list", ["guests_pkey", "guests_wedding_active_created_idx"]],
    ["invitation-lookup", ["invitations_token_hash_unique"]],
    ["auth-email-lookup", ["auth_accounts_email_key_unique"]],
    ["session-lookup", ["auth_sessions_token_hash_unique"]],
    ["due-email-jobs", ["auth_email_jobs_due_idx"]],
    ["rate-limit-cleanup", ["auth_rate_limits_expiry_cleanup_idx"]],
  ]);
  if (
    summaries.length !== 7 ||
    summaries.some(
      ({ name, nodes }) =>
        expectedIndexes.has(name) &&
        !nodes.some(([, index]) => expectedIndexes.get(name).includes(index)),
    )
  ) {
    throw new Error("A critical representative query plan is missing");
  }
  return { commitment: "disposable_branch_only", plans: summaries };
}

async function loadNeonInventory(branchId) {
  const projectId = process.env.RELEASE_NEON_PROJECT_ID;
  const apiKey = process.env.RELEASE_NEON_API_KEY;
  if (!projectId || !apiKey)
    throw new Error("Neon inventory credentials are missing");
  try {
    const response = await globalThis.fetch(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/endpoints`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: globalThis.AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error("provider error");
    return await response.json();
  } catch {
    throw new Error("Neon inventory is unavailable");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = await runQueryPlanProbe(
      {
        testDatabaseUrl: process.env.TEST_DATABASE_URL,
        activeStagingHost: process.env.RELEASE_STAGING_DATABASE_HOST,
        productionHost: process.env.RELEASE_PRODUCTION_DATABASE_HOST,
        expectedTestBranchId: process.env.RELEASE_TEST_BRANCH_ID,
        confirm: process.env.TEST_DATABASE_CONFIRM,
      },
      (config) => new pg.Client(config),
      loadNeonInventory,
    );
    for (const plan of report.plans) console.log(JSON.stringify(plan));
    console.log("synthetic transaction rolled back");
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Query-plan probe failed",
    );
    process.exitCode = 1;
  }
}
