// src/lib/email/theme.ts
import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";

export const EMAIL_BRAND = {
  name: EMAIL_DISPLAY_NAME,
};

export const EMAIL_FONT_STACK =
  "'Helvetica Neue', 'Avenir Next', 'Segoe UI', Arial, Helvetica, sans-serif";

export const EMAIL_COLORS = {
  background: "#f7f6f2",
  surface: "#ffffff",
  border: "#ded9cf",
  panel: "#ffffff",
  panelBorder: "#ded9cf",
  text: "#171717",
  muted: "#5f5a53",
  subtle: "#877f74",
  accent: "#171717",
  accentSoft: "#f3efe8",
};

export const emailStyles = {
  body: `margin:0;padding:0;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};`,
  outerTable: `background:${EMAIL_COLORS.background};padding:24px 12px;`,
  container: `width:100%;background:${EMAIL_COLORS.surface};`,
  logoCell: "padding:24px 24px 10px;text-align:left;",
  wordmarkWrap: `display:block;padding:0 0 14px;border-bottom:1px solid ${EMAIL_COLORS.border};`,
  wordmark: `margin:0;font-size:22px;line-height:1;letter-spacing:0.08em;font-weight:600;color:${EMAIL_COLORS.text};`,
  preheader:
    "display:none;font-size:1px;line-height:1px;color:#ffffff;max-height:0;max-width:0;opacity:0;overflow:hidden;",
  eyebrow: `font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${EMAIL_COLORS.subtle};font-weight:600;`,
  heading: `margin:10px 0 0;font-size:24px;line-height:1.28;font-weight:500;color:${EMAIL_COLORS.text};letter-spacing:0.01em;`,
  copy: `margin:0;font-size:14px;line-height:1.65;color:${EMAIL_COLORS.muted};`,
  subcopy: `margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.subtle};`,
  panel: `background:${EMAIL_COLORS.panel};border-top:1px solid ${EMAIL_COLORS.panelBorder};border-bottom:1px solid ${EMAIL_COLORS.panelBorder};`,
  label: `font-size:10px;color:${EMAIL_COLORS.subtle};text-transform:uppercase;letter-spacing:0.18em;`,
  labelAccent: `font-size:10px;color:${EMAIL_COLORS.subtle};text-transform:uppercase;letter-spacing:0.18em;font-weight:700;`,
  button: `display:inline-block;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.surface};text-decoration:none;font-weight:600;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;padding:13px 18px;border:1px solid ${EMAIL_COLORS.text};`,
  divider: `border-bottom:1px solid ${EMAIL_COLORS.border};`,
  link: `color:${EMAIL_COLORS.text};text-decoration:none;`,
  accentLink: `color:${EMAIL_COLORS.accent};text-decoration:none;`,
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;",
  codeBox: `display:inline-block;padding:12px 14px;border-bottom:1px solid ${EMAIL_COLORS.text};background:${EMAIL_COLORS.surface};`,
};
