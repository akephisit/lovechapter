import type { UiLanguage } from "./ui-language";

type CopyFor<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => string
    ? (...args: Args) => string
    : T[K] extends string
      ? string
      : CopyFor<T[K]>;
};

const en = {
  common: {
    signIn: "Sign in",
    itemCount: (count: number) =>
      `${new Intl.NumberFormat("en").format(count)} ${count === 1 ? "item" : "items"}`,
  },
  errors: { unexpected: "Something went wrong. Please try again." },
};

export type UiCopy = CopyFor<typeof en>;

const th: UiCopy = {
  common: {
    signIn: "เข้าสู่ระบบ",
    itemCount: (count) => `${new Intl.NumberFormat("th").format(count)} รายการ`,
  },
  errors: { unexpected: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" },
};

export function getUiCopy(language: UiLanguage): UiCopy {
  return language === "th" ? th : en;
}
