import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: process.env.DATABASE_URL
    ? { url: process.env.DATABASE_URL }
    : { url: "postgres://placeholder:placeholder@localhost:5432/lovechapter" },
  strict: true,
  verbose: true,
});
