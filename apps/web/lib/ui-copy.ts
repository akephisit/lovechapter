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
  errors: {
    unexpected: "Something went wrong. Please try again.",
    signUp: "We couldn't create your account.",
    signIn: "We couldn't sign you in.",
    resetLink: "We couldn't send the reset link.",
    invalidToken: "Invalid or expired token",
    invalidCredentials: "Invalid email or password",
    invalidInput: "Please check your information and try again.",
    rateLimited: "Too many attempts. Please try again later.",
    profileSave: "We couldn't save your profile. Please try again.",
    passwordLength: "Password must contain 12–128 Unicode characters.",
  },
  auth: {
    email: "Email address",
    password: "Password",
    displayName: "Display name",
    checkEmail: "Check your email",
    signUpTitle: "Create your account",
    signUpDescription: "Start a private planning space for your celebration.",
    signUpSent: "We sent a verification link if the address can receive one.",
    signUpNext:
      "Open the link in your email to verify your address before signing in.",
    signUpAlternate: "Already registered? Sign in",
    passwordHelp: "Use 12–128 characters. Spaces and Unicode are welcome.",
    creating: "Creating account…",
    createAccount: "Create account",
    signInTitle: "Welcome back",
    signInDescription: "Sign in to continue planning your chapter.",
    signInAlternate: "New here? Create an account",
    forgotPassword: "Forgot password?",
    signingIn: "Signing in…",
    signIn: "Sign in",
    verifyTitle: "Verify your email",
    verifiedTitle: "Email verified",
    verifyDescription: "We're checking your secure verification link.",
    verifiedDescription: "Your address is verified. You can sign in now.",
    verifying: "Verifying your email…",
    verified: "Verification complete.",
    continueSignIn: "Continue to sign in",
    forgotTitle: "Reset your password",
    forgotDescription: "Enter your email and we'll send a secure reset link.",
    forgotSent: "If an eligible account exists, a reset link is on its way.",
    forgotNext:
      "If an eligible account exists, you will receive an email shortly.",
    returnSignIn: "Return to sign in",
    sending: "Sending…",
    sendReset: "Send reset link",
    resetTitle: "Choose a new password",
    resetCompleteTitle: "Password reset",
    resetDescription: "Use 12–128 characters. Your password is never trimmed.",
    resetCompleteDescription:
      "Your sessions were closed and your new password is ready.",
    newPassword: "New password",
    resetting: "Resetting…",
    resetPassword: "Reset password",
    resetReading: "Reading your secure reset link…",
    signInNewPassword: "Sign in with your new password",
  },
  profile: {
    eyebrow: "One last detail",
    title: "How should we welcome you?",
    description:
      "This name appears in your private wedding workspace. You can use any language.",
    displayName: "Display name",
    nameLength: "Display name must be 1–120 characters",
    saving: "Saving…",
    continue: "Continue to LoveChapter",
  },
  session: {
    checking: "Checking your session…",
    errorTitle: "We couldn't restore your session.",
    errorDescription:
      "The service may be temporarily unavailable. Your account state has not been changed.",
    boundaryTitle: "We couldn't open your private workspace.",
    boundaryDescription:
      "Your invitation pages are unaffected. Try loading your account again.",
    retry: "Try again",
  },
  pageTitles: {
    signUp: "Create account",
    signIn: "Sign in",
    verifyEmail: "Verify email",
    forgotPassword: "Forgot password",
    resetPassword: "Reset password",
    invitation: "Private invitation",
  },
  rsvp: {
    opening: "Opening your invitation…",
    loadTitle: "We couldn't open this invitation",
    loadError: "We couldn't load this invitation. Please try again.",
    unavailableTitle: "Invitation unavailable",
    unavailableDescription:
      "This invitation may have expired or been replaced. Please ask the couple for a new link.",
    retry: "Try again",
    celebration: "A celebration of love",
    invited: "You're invited,",
    welcome: "Join us as we begin a beautiful new chapter together.",
    timeZone: (zone: string) => `Times shown in ${zone}`,
    datePending: "Date to be announced",
    badge: "Private RSVP",
    heading: "Will you join us?",
    editable: "Your response can be updated later using this same invitation.",
    response: "Your response",
    attending: "Joyfully accept",
    declined: "Regretfully decline",
    partySize: "Party size",
    partySizeOption: (size: number) =>
      `${size} ${size === 1 ? "guest" : "guests"}`,
    partyLimit: (size: number) => `This invitation welcomes up to ${size}.`,
    note: "Note (optional)",
    notePlaceholder: "Share a warm note with the couple…",
    saving: "Saving…",
    submit: "Save RSVP",
    saved: "Your RSVP is saved.",
    saveError: "We couldn't save your RSVP. Please try again.",
    invalidInput: "Please check your response and try again.",
    privateLink:
      "No account or password is needed. Keep this private invitation link safe.",
  },
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
  errors: {
    unexpected: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง",
    signUp: "ไม่สามารถสร้างบัญชีได้ กรุณาลองอีกครั้ง",
    signIn: "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองอีกครั้ง",
    resetLink: "ไม่สามารถส่งลิงก์ตั้งรหัสผ่านใหม่ได้ กรุณาลองอีกครั้ง",
    invalidToken: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว",
    invalidCredentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    invalidInput: "กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง",
    rateLimited: "ลองหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง",
    profileSave: "ไม่สามารถบันทึกโปรไฟล์ได้ กรุณาลองอีกครั้ง",
    passwordLength: "รหัสผ่านต้องมี 12–128 อักขระยูนิโค้ด",
  },
  auth: {
    email: "อีเมล",
    password: "รหัสผ่าน",
    displayName: "ชื่อที่แสดง",
    checkEmail: "ตรวจสอบอีเมลของคุณ",
    signUpTitle: "สร้างบัญชี",
    signUpDescription: "เริ่มพื้นที่วางแผนงานแต่งส่วนตัวของคุณ",
    signUpSent: "เราส่งลิงก์ยืนยันแล้ว หากอีเมลนี้รับข้อความได้",
    signUpNext: "เปิดลิงก์ในอีเมลเพื่อยืนยันที่อยู่ก่อนเข้าสู่ระบบ",
    signUpAlternate: "มีบัญชีแล้ว? เข้าสู่ระบบ",
    passwordHelp: "ใช้ 12–128 อักขระ เว้นวรรคและยูนิโค้ดได้",
    creating: "กำลังสร้างบัญชี…",
    createAccount: "สร้างบัญชี",
    signInTitle: "ยินดีต้อนรับกลับ",
    signInDescription: "เข้าสู่ระบบเพื่อวางแผนงานแต่งต่อ",
    signInAlternate: "ยังไม่มีบัญชี? สร้างบัญชี",
    forgotPassword: "ลืมรหัสผ่าน?",
    signingIn: "กำลังเข้าสู่ระบบ…",
    signIn: "เข้าสู่ระบบ",
    verifyTitle: "ยืนยันอีเมลของคุณ",
    verifiedTitle: "ยืนยันอีเมลแล้ว",
    verifyDescription: "กำลังตรวจสอบลิงก์ยืนยันที่ปลอดภัย",
    verifiedDescription: "ยืนยันอีเมลแล้ว คุณเข้าสู่ระบบได้เลย",
    verifying: "กำลังยืนยันอีเมล…",
    verified: "ยืนยันอีเมลสำเร็จ",
    continueSignIn: "ไปหน้าเข้าสู่ระบบ",
    forgotTitle: "ตั้งรหัสผ่านใหม่",
    forgotDescription: "กรอกอีเมล แล้วเราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้",
    forgotSent: "หากมีบัญชีที่เข้าเงื่อนไข เราจะส่งลิงก์ให้ทางอีเมล",
    forgotNext: "หากมีบัญชีที่เข้าเงื่อนไข คุณจะได้รับอีเมลในไม่ช้า",
    returnSignIn: "กลับไปหน้าเข้าสู่ระบบ",
    sending: "กำลังส่ง…",
    sendReset: "ส่งลิงก์ตั้งรหัสผ่านใหม่",
    resetTitle: "เลือกรหัสผ่านใหม่",
    resetCompleteTitle: "ตั้งรหัสผ่านใหม่แล้ว",
    resetDescription: "ใช้ 12–128 อักขระ ระบบจะไม่ตัดช่องว่างออกจากรหัสผ่าน",
    resetCompleteDescription:
      "ออกจากระบบทุกอุปกรณ์แล้ว และใช้รหัสผ่านใหม่ได้ทันที",
    newPassword: "รหัสผ่านใหม่",
    resetting: "กำลังตั้งรหัสผ่านใหม่…",
    resetPassword: "ตั้งรหัสผ่านใหม่",
    resetReading: "กำลังอ่านลิงก์ตั้งรหัสผ่านใหม่…",
    signInNewPassword: "เข้าสู่ระบบด้วยรหัสผ่านใหม่",
  },
  profile: {
    eyebrow: "อีกขั้นตอนเดียว",
    title: "อยากให้เราเรียกคุณว่าอะไร?",
    description: "ชื่อนี้จะแสดงในพื้นที่งานแต่งส่วนตัวของคุณ ใช้ภาษาใดก็ได้",
    displayName: "ชื่อที่แสดง",
    nameLength: "ชื่อที่แสดงต้องมี 1–120 อักขระ",
    saving: "กำลังบันทึก…",
    continue: "เข้าสู่ LoveChapter",
  },
  session: {
    checking: "กำลังตรวจสอบการเข้าสู่ระบบ…",
    errorTitle: "ไม่สามารถคืนค่าการเข้าสู่ระบบได้",
    errorDescription:
      "บริการอาจไม่พร้อมใช้งานชั่วคราว ข้อมูลบัญชีของคุณไม่เปลี่ยนแปลง",
    boundaryTitle: "ไม่สามารถเปิดพื้นที่ส่วนตัวของคุณได้",
    boundaryDescription: "หน้าคำเชิญยังใช้งานได้ กรุณาลองโหลดบัญชีอีกครั้ง",
    retry: "ลองอีกครั้ง",
  },
  pageTitles: {
    signUp: "สร้างบัญชี",
    signIn: "เข้าสู่ระบบ",
    verifyEmail: "ยืนยันอีเมล",
    forgotPassword: "ลืมรหัสผ่าน",
    resetPassword: "ตั้งรหัสผ่านใหม่",
    invitation: "คำเชิญส่วนตัว",
  },
  rsvp: {
    opening: "กำลังเปิดคำเชิญ…",
    loadTitle: "ไม่สามารถเปิดคำเชิญนี้ได้",
    loadError: "ไม่สามารถโหลดคำเชิญได้ กรุณาลองอีกครั้ง",
    unavailableTitle: "คำเชิญนี้ไม่พร้อมใช้งาน",
    unavailableDescription:
      "คำเชิญอาจหมดอายุหรือถูกเปลี่ยนแล้ว กรุณาขอลิงก์ใหม่จากคู่บ่าวสาว",
    retry: "ลองอีกครั้ง",
    celebration: "วันแห่งความรัก",
    invited: "ขอเชิญคุณ",
    welcome: "มาร่วมฉลองการเริ่มต้นบทใหม่ที่สวยงามไปด้วยกัน",
    timeZone: (zone) => `แสดงเวลาในเขตเวลา ${zone}`,
    datePending: "จะแจ้งวันที่ให้ทราบภายหลัง",
    badge: "ตอบรับคำเชิญส่วนตัว",
    heading: "คุณจะมาร่วมงานไหม?",
    editable: "คุณกลับมาแก้ไขคำตอบได้ภายหลังผ่านคำเชิญนี้",
    response: "คำตอบของคุณ",
    attending: "ยินดีไปร่วมงาน",
    declined: "ไม่สามารถไปร่วมงาน",
    partySize: "จำนวนผู้ร่วมงาน",
    partySizeOption: (size) => `${new Intl.NumberFormat("th").format(size)} คน`,
    partyLimit: (size) =>
      `คำเชิญนี้รองรับสูงสุด ${new Intl.NumberFormat("th").format(size)} คน`,
    note: "ข้อความถึงคู่บ่าวสาว (ไม่บังคับ)",
    notePlaceholder: "เขียนข้อความถึงคู่บ่าวสาว…",
    saving: "กำลังบันทึก…",
    submit: "ส่งคำตอบ",
    saved: "บันทึกคำตอบแล้ว",
    saveError: "ไม่สามารถบันทึกคำตอบได้ กรุณาลองอีกครั้ง",
    invalidInput: "กรุณาตรวจสอบคำตอบแล้วลองอีกครั้ง",
    privateLink:
      "ไม่ต้องสมัครบัญชีหรือใช้รหัสผ่าน โปรดเก็บลิงก์คำเชิญนี้ไว้เป็นส่วนตัว",
  },
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
