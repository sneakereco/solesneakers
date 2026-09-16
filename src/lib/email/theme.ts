// src/lib/email/theme.ts
import { BRAND_NAME } from "@/config/constants/brand";

export const EMAIL_BRAND = {
  name: BRAND_NAME,
};

export const EMAIL_FONT_STACK =
  "'Helvetica Neue', 'Avenir Next', 'Segoe UI', Arial, Helvetica, sans-serif";

export const EMAIL_COLORS = {
  background: "#f4f3ef",
  surface: "#ffffff",
  storefront: "#faf9f6",
  border: "#deddd7",
  panel: "#fbfbf9",
  panelBorder: "#e4e2dc",
  text: "#18181b",
  muted: "#52525b",
  subtle: "#71717a",
  accent: "#18181b",
  accentSoft: "#f1f0eb",
  inverse: "#ffffff",
  inverseMuted: "#a1a1aa",
};

export const emailStyles = {
  body: `margin:0;padding:0;width:100%;background:${EMAIL_COLORS.background};color:${EMAIL_COLORS.text};font-family:${EMAIL_FONT_STACK};-webkit-font-smoothing:antialiased;`,
  outerTable: `width:100%;background:${EMAIL_COLORS.background};padding:32px 12px;`,
  container: `width:100%;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.border};border-radius:16px;overflow:hidden;border-collapse:separate;`,
  logoCell: `padding:26px 24px 24px;text-align:center;background:${EMAIL_COLORS.storefront};border-bottom:1px solid ${EMAIL_COLORS.border};`,
  logo: "display:block;width:156px;max-width:100%;height:auto;margin:0 auto;border:0;",
  preheader: `display:none!important;font-size:1px;line-height:1px;color:${EMAIL_COLORS.background};max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;`,
  heroCell: `padding:40px 40px 26px;text-align:left;background:${EMAIL_COLORS.surface};`,
  eyebrow: `display:block;font-size:12px;line-height:1.4;letter-spacing:0.08em;color:${EMAIL_COLORS.subtle};font-weight:600;`,
  heading: `margin:10px 0 0;font-size:30px;line-height:1.2;font-weight:700;color:${EMAIL_COLORS.text};letter-spacing:-0.025em;`,
  copy: `margin:0;font-size:15px;line-height:1.7;color:${EMAIL_COLORS.muted};`,
  subcopy: `margin:0;font-size:12px;line-height:1.65;color:${EMAIL_COLORS.subtle};`,
  panel: `background:${EMAIL_COLORS.panel};border:1px solid ${EMAIL_COLORS.panelBorder};border-radius:12px;overflow:hidden;`,
  label: `font-size:11px;line-height:1.4;color:${EMAIL_COLORS.subtle};letter-spacing:0.06em;font-weight:600;`,
  labelAccent: `font-size:12px;line-height:1.4;color:${EMAIL_COLORS.text};letter-spacing:0.04em;font-weight:700;`,
  button: `display:inline-block;background:${EMAIL_COLORS.text};color:${EMAIL_COLORS.inverse};text-decoration:none;font-weight:600;font-size:14px;line-height:1.2;padding:14px 22px;border:1px solid ${EMAIL_COLORS.text};border-radius:10px;`,
  divider: `border-bottom:1px solid ${EMAIL_COLORS.border};`,
  link: `color:inherit;text-decoration:underline;text-underline-offset:3px;`,
  accentLink: `color:${EMAIL_COLORS.accent};text-decoration:underline;text-underline-offset:3px;`,
  code: "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;",
  codeBox: `display:inline-block;padding:16px 20px;border:1px solid ${EMAIL_COLORS.panelBorder};border-radius:12px;background:${EMAIL_COLORS.panel};font-size:24px;font-weight:700;letter-spacing:0.16em;`,
};
