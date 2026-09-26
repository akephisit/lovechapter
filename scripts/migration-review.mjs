import { readFile } from "node:fs/promises";

const migrationDirectory = "packages/database/drizzle/";
const requiredSections = [
  "Classification",
  "Data transformation",
  "Locking and query effects",
  "Validation",
  "Recovery",
];

/** Classify only changed SQL migrations with an explicit review document. */
export async function validateMigrationReviews(
  changes,
  readReview = (path) => readFile(path, "utf8"),
) {
  const migrations = changes.filter(
    ({ path }) => path.startsWith(migrationDirectory) && path.endsWith(".sql"),
  );
  if (migrations.length === 0) return { kind: "none", paths: [] };

  const paths = migrations.map(({ path }) => path);
  if (migrations.some(({ status }) => status === "D")) {
    return { kind: "blocked", paths };
  }

  let kind = "nonbreaking";
  for (const { path, status } of migrations) {
    if (status !== "A" && status !== "M") {
      return { kind: "blocked", paths };
    }
    const basename =
      /^packages\/database\/drizzle\/([A-Za-z0-9_-]+)\.sql$/.exec(path)?.[1];
    if (!basename) return { kind: "blocked", paths };

    const reviewPath = `${migrationDirectory}reviews/${basename}.md`;
    let review;
    try {
      review = await readReview(reviewPath);
    } catch {
      throw new Error(`Migration review is missing: ${reviewPath}`);
    }
    const sections = parseSections(review);
    const classification = sections.get("Classification");
    const breaking = readBoolean(classification, "breaking");
    const dataDeletion = readBoolean(classification, "data_deletion");
    if (dataDeletion) return { kind: "blocked", paths };
    if (breaking) kind = "breaking";
  }

  return { kind, paths };
}

function parseSections(review) {
  const matches = [...review.matchAll(/^## ([^\n]+)\s*$/gm)];
  const sections = new Map();
  for (let index = 0; index < matches.length; index += 1) {
    const name = matches[index][1].trim();
    if (sections.has(name))
      throw new Error(`Duplicate migration review section: ${name}`);
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? review.length;
    sections.set(name, review.slice(start, end).trim());
  }
  for (const name of requiredSections) {
    if (!sections.get(name)) {
      throw new Error(`Migration review section is missing or empty: ${name}`);
    }
  }
  return sections;
}

function readBoolean(section, key) {
  const pattern = new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "gmi");
  const matches = [...section.matchAll(pattern)];
  if (matches.length !== 1 || !["yes", "no"].includes(matches[0][1])) {
    throw new Error(`Migration review ${key} must be yes or no`);
  }
  return matches[0][1] === "yes";
}
