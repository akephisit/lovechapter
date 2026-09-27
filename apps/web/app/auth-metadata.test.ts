import { describe, expect, it, vi } from "vitest";
import { generateMetadata as signUp } from "./(auth)/sign-up/page";
import { generateMetadata as signIn } from "./(auth)/sign-in/page";
import { generateMetadata as verify } from "./(auth)/verify-email/page";
import { generateMetadata as forgot } from "./(auth)/forgot-password/page";
import { generateMetadata as reset } from "./(auth)/reset-password/page";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "th" }) }),
  headers: async () => new Headers({ "accept-language": "en-US" }),
}));

describe("auth route metadata", () => {
  it.each([
    ["sign up", signUp, "สร้างบัญชี"],
    ["sign in", signIn, "เข้าสู่ระบบ"],
    ["verify email", verify, "ยืนยันอีเมล"],
    ["forgot password", forgot, "ลืมรหัสผ่าน"],
    ["reset password", reset, "ตั้งรหัสผ่านใหม่"],
  ])("uses Thai for %s", async (_route, metadata, title) => {
    expect(await metadata()).toMatchObject({ title });
  });
});
