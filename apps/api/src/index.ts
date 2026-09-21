import { env } from "cloudflare:workers";

import { withPostgresRepository } from "@lovechapter/database";
import { LoveChapterService } from "@lovechapter/domain";

import {
  createApiIdentityProvider,
  parsePublicWebOrigin,
} from "./api-identity";
import { createApiApp } from "./app";

const publicWebOrigin = parsePublicWebOrigin(env.PUBLIC_WEB_ORIGIN);
const identity = createApiIdentityProvider({
  ...env,
  PUBLIC_WEB_ORIGIN: publicWebOrigin,
});

const app = createApiApp({
  publicWebOrigin,
  run: (request, operation) =>
    withPostgresRepository(env.HYPERDRIVE.connectionString, (repository) =>
      operation(
        new LoveChapterService(identity, repository, publicWebOrigin, request),
      ),
    ),
});

export default app.compile();
