// src/lib/email/theme.ts
import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";

export const EMAIL_BRAND = {
  name: EMAIL_DISPLAY_NAME,
  kicker: "Curated sneaker and streetwear updates",
};

export const EMAIL_FONT_STACK =
  "'Helvetica Neue', 'Avenir Next', 'Segoe UI', Arial, Helvetica, sans-serif";

export const EMAIL_COLORS = {
  background: "#f3f0ea",
  surface: "#ffffff",
  border: "#d8d1c5",
  panel: "#f7f3ec",
  panelBorder: "#e3dbcf",
  text: "#171717",
  muted: "#5f5a53",
  subtle: "#877f74",
  accent: "#8c6a44",
  accentSoft: "#efe5d7",
};

export const emailStyles = {
  body: `margin:0;padding:0;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};`,
  outerTable: `background:${EMAIL_COLORS.background};padding:28px 12px;`,
  container: `width:100%;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};`,
  logoCell: "padding:26px 28px 18px;text-align:center;",
  wordmarkWrap: `display:inline-block;padding:0 0 16px;border-bottom:1px solid ${EMAIL_COLORS.border};`,
  wordmark: `margin:0;font-size:28px;line-height:1;letter-spacing:0.04em;font-weight:600;color:${EMAIL_COLORS.text};`,
  kicker: `margin:10px 0 0;font-size:11px;line-height:1.6;letter-spacing:0.2em;text-transform:uppercase;color:${EMAIL_COLORS.subtle};`,
  preheader:
    "display:none;font-size:1px;line-height:1px;color:#ffffff;max-height:0;max-width:0;opacity:0;overflow:hidden;",
  eyebrow: `font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:${EMAIL_COLORS.accent};font-weight:600;`,
  heading: `margin:12px 0 0;font-size:28px;line-height:1.28;font-weight:500;color:${EMAIL_COLORS.text};letter-spacing:0.01em;`,
  copy: `margin:0;font-size:14px;line-height:1.7;color:${EMAIL_COLORS.muted};`,
  subcopy: `margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.subtle};`,
  panel: `background:${EMAIL_COLORS.panel};border:1px solid ${EMAIL_COLORS.panelBorder};`,
  label: `font-size:11px;color:${EMAIL_COLORS.muted};text-transform:uppercase;letter-spacing:0.22em;`,
  labelAccent: `font-size:11px;color:${EMAIL_COLORS.accent};text-transform:uppercase;letter-spacing:0.22em;font-weight:700;`,
  button: `display:inline-block;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.surface};text-decoration:none;font-weight:600;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;padding:14px 22px;border:1px solid ${EMAIL_COLORS.text};`,
  divider: `border-bottom:1px solid ${EMAIL_COLORS.border};`,
  link: `color:${EMAIL_COLORS.text};text-decoration:none;`,
  accentLink: `color:${EMAIL_COLORS.accent};text-decoration:none;`,
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;",
  codeBox: `display:inline-block;padding:14px 18px;border:1px solid ${EMAIL_COLORS.panelBorder};background:${EMAIL_COLORS.surface};`,
};
