// src/lib/email/theme.ts
import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";

export const EMAIL_BRAND = {
  name: EMAIL_DISPLAY_NAME,
};

export const EMAIL_FONT_STACK =
  "'Helvetica Neue', 'Avenir Next', 'Segoe UI', Arial, Helvetica, sans-serif";

export const EMAIL_COLORS = {
  background: "#eeeeea",
  surface: "#ffffff",
  storefront: "#f8f8f6",
  border: "#deded8",
  panel: "#f8f8f6",
  panelBorder: "#deded8",
  text: "#09090b",
  muted: "#52525b",
  subtle: "#71717a",
  accent: "#09090b",
  accentSoft: "#f0f0ec",
  inverse: "#ffffff",
  inverseMuted: "#a1a1aa",
};

export const emailStyles = {
  body: `margin:0;padding:0;width:100%;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};-webkit-font-smoothing:antialiased;`,
  outerTable: `width:100%;background:${EMAIL_COLORS.background};padding:32px 12px;`,
  container: `width:100%;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-collapse:separate;`,
  announcement: `padding:11px 20px;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.inverse};font-size:9px;line-height:1.4;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;text-align:center;`,
  logoCell: `padding:26px 24px 24px;text-align:center;background:${EMAIL_COLORS.storefront};border-bottom:1px solid ${EMAIL_COLORS.border};`,
  logo: "display:block;width:154px;max-width:100%;height:auto;margin:0 auto;border:0;",
  preheader:
    "display:none!important;font-size:1px;line-height:1px;color:#eeeeea;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;",
  heroCell: `padding:42px 40px 30px;text-align:center;background:${EMAIL_COLORS.surface};`,
  eyebrow: `font-size:10px;line-height:1.4;letter-spacing:0.24em;text-transform:uppercase;color:${EMAIL_COLORS.subtle};font-weight:700;`,
  heading: `margin:12px 0 0;font-size:30px;line-height:1.12;font-weight:600;color:${EMAIL_COLORS.text};letter-spacing:-0.02em;text-transform:uppercase;`,
  copy: `margin:0;font-size:15px;line-height:1.7;color:${EMAIL_COLORS.muted};`,
  subcopy: `margin:0;font-size:12px;line-height:1.65;color:${EMAIL_COLORS.subtle};`,
  panel: `background:${EMAIL_COLORS.panel};border:1px solid ${EMAIL_COLORS.panelBorder};`,
  label: `font-size:9px;line-height:1.4;color:${EMAIL_COLORS.subtle};text-transform:uppercase;letter-spacing:0.2em;font-weight:700;`,
  labelAccent: `font-size:10px;line-height:1.4;color:${EMAIL_COLORS.text};text-transform:uppercase;letter-spacing:0.2em;font-weight:700;`,
  button: `display:inline-block;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.inverse};text-decoration:none;font-weight:700;font-size:10px;line-height:1.2;letter-spacing:0.2em;text-transform:uppercase;padding:16px 25px;border:1px solid ${EMAIL_COLORS.text};border-radius:999px;`,
  divider: `border-bottom:1px solid ${EMAIL_COLORS.border};`,
  link: `color:inherit;text-decoration:underline;text-underline-offset:3px;`,
  accentLink: `color:${EMAIL_COLORS.accent};text-decoration:underline;text-underline-offset:3px;`,
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;",
  codeBox: `display:inline-block;padding:13px 16px;border:1px solid ${EMAIL_COLORS.text};background:${EMAIL_COLORS.surface};font-size:18px;letter-spacing:0.12em;`,
};
