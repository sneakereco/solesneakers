import assert from "node:assert/strict";
import { expect } from "@playwright/test";

async function geometry(element) {
  return element.evaluate((el) => {
    const { width, height } = el.getBoundingClientRect();
    return { width: Math.round(width), height: Math.round(height) };
  });
}
async function contrast(element) {
  return element.evaluate((el) => {
    const rgb = (value) => value.match(/[\d.]+/g)?.map(Number);
    const luminance = (color) =>
      color
        .slice(0, 3)
        .map((x) => x / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
        .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
    const fg = rgb(getComputedStyle(el).color);
    let bg = [255, 255, 255];
    for (let owner = el; owner; owner = owner.parentElement) {
      const color = rgb(getComputedStyle(owner).backgroundColor);
      if (color && (color.length === 3 || color[3] === 1)) {
        bg = color;
        break;
      }
    }
    const a = luminance(fg),
      b = luminance(bg);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
  });
}
export async function measureSurfaces(width, catalog, staff) {
  const grid = catalog.getByRole("button", { name: "Grid view" });
  const card = catalog.getByTestId("product-card").first();
  const save = staff.getByRole("button", { name: "Create Product", exact: true });
  const result = {
    width,
    catalogGrid: await geometry(grid),
    productLink: await geometry(card),
    save: await geometry(save),
  };
  for (const target of [result.catalogGrid, result.productLink, result.save])
    assert.ok(target.width >= 44 && target.height >= 44);
  await expect(staff.getByLabel("Full Title", { exact: false })).toHaveAccessibleName(
    /Full Title/,
  );
  assert.equal(
    await catalog.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    true,
  );
  if (width < 768) {
    const open = staff.getByRole("button", { name: "Open admin menu" });
    result.adminMenu = await geometry(open);
    await open.focus();
    await staff.keyboard.press("Enter");
    const modal = staff.getByRole("dialog", { name: "Admin menu" });
    await expect(modal).toBeVisible();
    assert.equal(await modal.evaluate((el) => el.contains(document.activeElement)), true);
    result.staffCaptionContrast = await contrast(
      modal.getByText("Operations", { exact: true }),
    );
    result.roleCaptionContrast = await contrast(
      modal.locator('a[href="/admin/profile"] span.uppercase').last(),
    );
    await staff.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(open).toBeFocused();
  } else {
    const caption = staff
      .getByText("Operations", { exact: true })
      .filter({ visible: true })
      .first();
    result.staffCaptionContrast = await contrast(caption);
    result.roleCaptionContrast = await contrast(
      staff
        .locator('a[href="/admin/profile"] span.uppercase')
        .filter({ visible: true })
        .last(),
    );
  }
  assert.ok(result.staffCaptionContrast >= 4.5 && result.roleCaptionContrast >= 4.5);
  return result;
}
