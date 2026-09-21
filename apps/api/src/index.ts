import { env } from "cloudflare:workers";

import { withPostgresRepository } from "@lovechapter/database";
import {
  createConfiguredIdentityProvider,
  LoveChapterService,
} from "@lovechapter/domain";

import { createApiApp } from "./app";

const identity = createConfiguredIdentityProvider(env);

const app = createApiApp({
  publicWebOrigin: env.PUBLIC_WEB_ORIGIN,
  run: (request, operation) =>
    withPostgresRepository(env.HYPERDRIVE.connectionString, (repository) =>
      operation(
        new LoveChapterService(
          identity,
          repository,
          env.PUBLIC_WEB_ORIGIN,
          request,
        ),
      ),
    ),
});

export default app.compile();
