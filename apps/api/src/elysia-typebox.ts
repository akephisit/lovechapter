import { setupTypebox } from "elysia";
import * as compile from "typebox/compile";
import * as schemaBase from "typebox/schema";
import * as system from "typebox/system";
import * as type from "typebox/type";
import * as value from "typebox/value";

// Elysia 2.0.0-beta.16 expects the schema namespace's Compile export to
// expose TypeBox's compiled validator shape. TypeBox 1.3 exposes that from
// typebox/compile instead. Keep the version-specific compatibility shim here
// so it can be deleted when the Cloudflare adapter and compiler stabilize.
const schema = { ...schemaBase, Compile: compile.Compile };

setupTypebox({ typebox: { type, system, value, schema, compile } });
