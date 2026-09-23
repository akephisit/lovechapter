import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseGuestCsv, GuestCsvParseError } from "./guest-csv-parser";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("bounded guest CSV parser", () => {
  it("accepts UTF-8 BOM, quoted commas/newlines/quotes, Thai text, blank rows and stable raw SHA-256", async () => {
    const source =
      '\uFEFFname,note\r\n"สมชาย, 😊","first\n""second"""\r\n\r\nDao,hello\n';
    const result = await parseGuestCsv(bytes(source));
    expect(result.headers).toEqual(["name", "note"]);
    expect(result.rows).toEqual([
      ["สมชาย, 😊", 'first\n"second"'],
      ["Dao", "hello"],
    ]);
    expect(result.sourceSha256).toBe(
      createHash("sha256").update(bytes(source)).digest("hex"),
    );
  });

  it.each([
    ["", "empty_file"],
    ["name;email\nNok;nok@example.test\n", "unsupported_delimiter"],
    ['name,email\n"unterminated,Nok\n', "malformed_csv"],
    ["name,email\nNok\n", "malformed_csv"],
    ["name, \nNok,one\n", "invalid_header"],
    ["Name,name\nNok,one\n", "duplicate_header"],
    ["name,email\nNok,\u0000\n", "binary_input"],
  ])("rejects invalid input as %s", async (source, code) => {
    await expect(parseGuestCsv(bytes(source))).rejects.toMatchObject({ code });
  });

  it("rejects invalid UTF-8 and exposes no source values in the error", async () => {
    const invalid = new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0xff]);
    await expect(parseGuestCsv(invalid)).rejects.toMatchObject({
      code: "invalid_utf8",
    });
    try {
      await parseGuestCsv(bytes('name\n"private source,broken'));
    } catch (error) {
      expect(error).toBeInstanceOf(GuestCsvParseError);
      expect(String(error)).not.toContain("private source");
    }
  });

  it("enforces 40 columns, 5,000 rows, and 4,096 Unicode characters per cell", async () => {
    await expect(
      parseGuestCsv(
        bytes(
          Array.from({ length: 41 }, (_, index) => `h${index}`).join(",") +
            "\n",
        ),
      ),
    ).rejects.toMatchObject({ code: "too_many_columns" });
    await expect(
      parseGuestCsv(bytes(`name\n${"Nok\n".repeat(5001)}`)),
    ).rejects.toMatchObject({ code: "too_many_rows" });
    await expect(
      parseGuestCsv(bytes(`name\n${"😊".repeat(4097)}\n`)),
    ).rejects.toMatchObject({ code: "cell_too_long" });
    await expect(
      parseGuestCsv(bytes(`name,${"x".repeat(4097)}\nNok,value\n`)),
    ).rejects.toMatchObject({ code: "cell_too_long", rowNumber: 1 });
  });
});
