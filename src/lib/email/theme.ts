// src/lib/email/theme.ts
import { EMAIL_DISPLAY_NAME } from "@/config/constants/mail";

export const EMAIL_BRAND = {
  name: EMAIL_DISPLAY_NAME,
};

export const EMAIL_FONT_STACK =
  "'Helvetica Neue', 'Avenir Next', 'Segoe UI', Arial, Helvetica, sans-serif";

export const EMAIL_COLORS = {
  background: "#e9e9e4",
  surface: "#f8f8f6",
  storefront: "#f8f8f6",
  border: "#09090b",
  panel: "#ffffff",
  panelBorder: "#cfcfc7",
  text: "#080808",
  muted: "#3f3f46",
  subtle: "#686863",
  accent: "#09090b",
  accentSoft: "#efefea",
  inverse: "#ffffff",
  inverseMuted: "#a1a1aa",
};

export const emailStyles = {
  body: `margin:0;padding:0;width:100%;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};-webkit-font-smoothing:antialiased;`,
  outerTable: `width:100%;background:${EMAIL_COLORS.background};padding:40px 12px;`,
  container: `width:100%;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-collapse:separate;`,
  announcement: `padding:12px 20px;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.inverse};font-size:9px;line-height:1.4;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;text-align:center;`,
  logoCell: `padding:31px 24px 29px;text-align:center;background:${EMAIL_COLORS.storefront};border-bottom:1px solid ${EMAIL_COLORS.border};`,
  logo: "display:block;width:168px;max-width:100%;height:auto;margin:0 auto;border:0;",
  preheader:
    "display:none!important;font-size:1px;line-height:1px;color:#e9e9e4;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;",
  heroCell: `padding:50px 40px 32px;text-align:left;background:${EMAIL_COLORS.surface};`,
  eyebrow: `display:inline-block;padding:7px 10px;background:${EMAIL_COLORS.text};font-size:9px;line-height:1.3;letter-spacing:0.22em;text-transform:uppercase;color:${EMAIL_COLORS.inverse};font-weight:700;`,
  heading: `margin:18px 0 0;font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;font-size:40px;line-height:0.98;font-style:italic;font-weight:900;color:${EMAIL_COLORS.text};letter-spacing:-0.055em;text-transform:uppercase;`,
  copy: `margin:0;font-size:15px;line-height:1.7;color:${EMAIL_COLORS.muted};`,
  subcopy: `margin:0;font-size:12px;line-height:1.65;color:${EMAIL_COLORS.subtle};`,
  panel: `background:${EMAIL_COLORS.panel};border:1px solid ${EMAIL_COLORS.text};`,
  label: `font-size:9px;line-height:1.4;color:${EMAIL_COLORS.subtle};text-transform:uppercase;letter-spacing:0.2em;font-weight:700;`,
  labelAccent: `font-size:10px;line-height:1.4;color:${EMAIL_COLORS.text};text-transform:uppercase;letter-spacing:0.22em;font-weight:700;`,
  button: `display:inline-block;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.inverse};text-decoration:none;font-weight:700;font-size:10px;line-height:1.2;letter-spacing:0.2em;text-transform:uppercase;padding:17px 28px;border:1px solid ${EMAIL_COLORS.text};border-radius:0;`,
  divider: `border-bottom:1px solid ${EMAIL_COLORS.border};`,
  link: `color:inherit;text-decoration:underline;text-underline-offset:3px;`,
  accentLink: `color:${EMAIL_COLORS.accent};text-decoration:underline;text-underline-offset:3px;`,
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;",
  codeBox: `display:inline-block;padding:16px 20px;border:1px solid ${EMAIL_COLORS.text};background:${EMAIL_COLORS.panel};font-size:24px;font-weight:700;letter-spacing:0.16em;`,
};
