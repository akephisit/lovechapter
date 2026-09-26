# 0011 release versions review

## Classification

breaking: no

data_deletion: no

## Data transformation

Add four nullable version/source-SHA columns to the singleton release-control row. Existing rows remain without a version baseline until an accepted release atomically records both Worker versions. The first versioned release must deploy both Workers; no legacy evidence is accepted for reopening.

## Locking and query effects

PostgreSQL takes a table lock for the four nullable column additions and validates the all-or-none check constraint. `ops.release_control` contains one row. No index is added: status and update use its singleton primary key. The status query adds four scalar columns and no additional round trip.

## Validation

Run `drizzle-kit check`, release-evidence and gate tests, and the disposable PostgreSQL release-gate integration suite. Confirm the old singleton row has all four new fields null; confirm a valid reopen stores all four atomically, and a partial version pair violates the constraint. Rehearse staging behind maintenance before production migration.

## Recovery

Do not roll back code alone after a schema/release mismatch. Leave maintenance closed, use a reviewed forward fix or restore an isolated Neon recovery point and validate the complete Worker pair. The additive columns can remain unused while recovery is assessed; no existing data is discarded.
