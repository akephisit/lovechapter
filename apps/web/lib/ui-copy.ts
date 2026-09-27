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
    language: "Language",
    itemCount: (count: number) =>
      `${new Intl.NumberFormat("en").format(count)} ${count === 1 ? "item" : "items"}`,
  },
  errors: { unexpected: "Something went wrong. Please try again." },
  metadata: {
    title: "LoveChapter — Wedding planning & RSVP",
    description:
      "A calm wedding workspace for couples and a private, account-free RSVP for guests.",
  },
  maintenance: {
    title: "LoveChapter is temporarily unavailable",
    message: "Service temporarily unavailable. Please try again shortly.",
    notice:
      "After the release, returning tabs reload automatically. Unsaved form input in this tab may be lost.",
    applyLanguage: "Change language",
  },
};

export type UiCopy = CopyFor<typeof en>;

const th: UiCopy = {
  common: {
    signIn: "เข้าสู่ระบบ",
    language: "ภาษา",
    itemCount: (count) => `${new Intl.NumberFormat("th").format(count)} รายการ`,
  },
  errors: { unexpected: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง" },
  metadata: {
    title: "LoveChapter — วางแผนงานแต่งและตอบรับคำเชิญ",
    description:
      "พื้นที่วางแผนงานแต่งสำหรับคู่รัก และหน้าตอบรับคำเชิญส่วนตัวสำหรับแขกโดยไม่ต้องสมัครบัญชี",
  },
  maintenance: {
    title: "LoveChapter ไม่สามารถใช้งานได้ชั่วคราว",
    message: "ไม่สามารถใช้งานได้ชั่วคราว กรุณาลองอีกครั้งในอีกสักครู่",
    notice:
      "เมื่อปรับปรุงเสร็จ แท็บที่เปิดค้างจะโหลดใหม่โดยอัตโนมัติ ข้อมูลในแบบฟอร์มที่ยังไม่บันทึกอาจสูญหาย",
    applyLanguage: "เปลี่ยนภาษา",
  },
};

export function getUiCopy(language: UiLanguage): UiCopy {
  return language === "th" ? th : en;
}
