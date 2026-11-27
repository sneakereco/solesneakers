import type * as NextServer from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import BrandsPage from "@/app/(store)/brands/page";
import ProductPage, { generateMetadata } from "@/app/(store)/store/[productId]/page";
import LockedPage from "@/app/locked/page";
import AuthLayout from "@/app/auth/layout";
import { getInventoryProducts } from "@/app/admin/inventory/actions";
import { getFormInitialData } from "@/app/admin/inventory/create/actions";
import { getEditFormInitialData } from "@/app/admin/inventory/[id]/edit/actions";
import { requireAdmin } from "@/lib/auth/session";

const mockBrands = jest.fn();
const mockProduct = jest.fn();
const mockSpecialty = jest.fn();
const mockSettings = jest.fn();
const mockTenant = jest.fn();
const mockProducts = jest.fn();
const mockSizes = jest.fn();
const mockSize = jest.fn();
jest.mock("@/Modules/SpecialtyProducts/Source/Features/Discovery/discovery", () => ({
  getSpecialtyProductPage: (...args: unknown[]) => mockSpecialty(...args),
}));
jest.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
jest.mock("next/server", () => ({
  ...jest.requireActual<typeof NextServer>("next/server"),
  connection: () => Promise.resolve(),
}));
jest.mock("@/components/store/ProductDetail", () => ({ ProductDetail: () => null }));
jest.mock("@/app/locked/unlock-timer", () => ({ UnlockTimer: () => null }));
jest.mock("@/components/auth/ui/AuthShell", () => ({ default: () => null }));
jest.mock("@/repositories/tag-taxonomy-repo", () => ({
  TagTaxonomyRepository: jest.fn().mockImplementation(() => ({
    listBrands: mockBrands,
    listSizes: mockSizes,
    listModels: () => Promise.resolve([]),
    getSizeById: mockSize,
  })),
}));
jest.mock("@/repositories/product-repo", () => ({
  ProductRepository: jest.fn().mockImplementation(() => ({ getById: mockProduct })),
}));
jest.mock("@/repositories/tenant-repo", () => ({
  TenantRepository: jest
    .fn()
    .mockImplementation(() => ({ getFirstTenantId: mockTenant })),
}));
jest.mock("@/services/store-access-settings-service", () => ({
  StoreAccessSettingsService: jest
    .fn()
    .mockImplementation(() => ({ getSettings: mockSettings, isSiteLocked: () => true })),
}));
jest.mock("@/services/product-service", () => ({
  ProductService: jest.fn().mockImplementation(() => ({
    listProducts: mockProducts,
    getProductById: mockProduct,
  })),
}));
jest.mock("@/lib/supabase/public", () => ({ createSupabasePublicClient: () => ({}) }));
jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: () => ({}),
}));
jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({}),
}));
jest.mock("@/lib/auth/session", () => ({
  getServerSession: () => Promise.resolve(null),
  requireAdmin: jest.fn(() => Promise.resolve({ role: "admin" })),
}));
jest.mock("@/lib/auth/tenant", () => ({
  ensureTenantId: () => Promise.resolve("tenant"),
}));

const id = "00000000-0000-4000-8000-000000000001";
const params = Promise.resolve({ productId: id });
const item = {
  id,
  name: "Fixture product",
  condition: "new",
  variants: [{ size: { id: "s" }, sale_price_cents: 5000, stock: 1 }],
  brand: { id: "b" },
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockBrands.mockResolvedValue([{ id: "b", canonical_label: "Fixture brand" }]);
  mockProduct.mockResolvedValue(item);
  mockSpecialty.mockResolvedValue(null);
  mockSizes.mockResolvedValue([]);
  mockSize.mockResolvedValue({ id: "s", canonical_label: "Small", size_type: "shoe" });
  mockProducts.mockResolvedValue({ products: [item], total: 1 });
  mockTenant.mockResolvedValue("tenant");
  mockSettings.mockResolvedValue({ siteUnlockAt: "2030-01-01T00:00:00Z" });
});
afterEach(() => jest.useRealTimers());

async function atDeadline<T>(read: () => Promise<T>) {
  let settled: { value: T } | { error: unknown } | undefined;
  void read().then(
    (value) => {
      settled = { value };
    },
    (error: unknown) => {
      settled = { error };
    },
  );
  await jest.advanceTimersByTimeAsync(15000);
  expect(settled).toBeDefined();
  return settled!;
}
const held = () => new Promise<never>(() => {});

it("cold brands exit on expiry and recover on a new read", async () => {
  mockBrands.mockReturnValueOnce(held());
  expect(await atDeadline(BrandsPage)).toMatchObject({ error: { name: "TimeoutError" } });
  expect(renderToStaticMarkup(await BrandsPage())).toContain("Fixture brand");
});
it("cold product metadata exits on expiry without claiming a missing product", async () => {
  mockProduct.mockReturnValueOnce(held());
  expect(await atDeadline(() => generateMetadata({ params }))).toMatchObject({
    error: { name: "TimeoutError" },
  });
  expect((await generateMetadata({ params })).title).toContain("Fixture product");
});
it("cold product detail exits on expiry and distinguishes recovery from confirmed absence", async () => {
  mockProduct.mockReturnValueOnce(held());
  expect(await atDeadline(() => ProductPage({ params }))).toMatchObject({
    error: { name: "TimeoutError" },
  });
  expect((await ProductPage({ params })).props.product).toBe(item);
  mockProduct.mockResolvedValueOnce(null);
  await expect(ProductPage({ params })).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
});
it("lock display times out its tenant/settings chain and offers retry without opening the store", async () => {
  mockSettings.mockReturnValueOnce(held());
  const result = await atDeadline(() => LockedPage({}));
  if (!("value" in result)) throw Error("Missing locked recovery view");
  expect(renderToStaticMarkup(result.value)).toMatch(/Retry/i);
  expect(renderToStaticMarkup(await LockedPage({}))).toContain(
    "Storefront temporarily closed",
  );
});
it("auth layout admits the login form after a held tenant lookup and restores the locked layout on recovery", async () => {
  mockTenant.mockReturnValueOnce(held());
  expect(await atDeadline(() => AuthLayout({ children: "login" }))).toMatchObject({
    value: { props: { children: "login", isSiteLocked: false } },
  });
  expect((await AuthLayout({ children: "login" })).props.isSiteLocked).toBe(true);
});
it.each([
  ["list and counts", mockProducts, () => getInventoryProducts()],
  ["create taxonomy", mockBrands, () => getFormInitialData()],
  ["edit product", mockProduct, () => getEditFormInitialData(id)],
  ["edit follow-on size", mockSize, () => getEditFormInitialData(id)],
] as const)(
  "bounds the complete authorized inventory %s read and recovers",
  async (_name, read, load) => {
    read.mockReturnValueOnce(held());
    expect(await atDeadline<unknown>(load)).toMatchObject({
      error: { name: "TimeoutError" },
    });
    expect(requireAdmin).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalled();
    await expect(load()).resolves.toBeDefined();
    expect(requireAdmin).toHaveBeenCalledTimes(2);
  },
);
it("shares one deadline across tenant and then lock settings reads", async () => {
  mockTenant.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve("tenant"), 9000)),
  );
  mockSettings.mockImplementationOnce(
    () =>
      new Promise((resolve) => setTimeout(() => resolve({ siteUnlockAt: null }), 9000)),
  );
  const result = await atDeadline(() => LockedPage({}));
  if (!("value" in result)) throw Error("Missing lock recovery view");
  expect(mockSettings).toHaveBeenCalledTimes(1);
  expect(renderToStaticMarkup(result.value)).toContain("Store access unavailable");
});

it("shares one post-authorization deadline across the staff product and follow-on lookup", async () => {
  mockProduct.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(item), 9000)),
  );
  mockSize.mockImplementationOnce(
    () =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ id: "s", canonical_label: "Small", size_type: "shoe" }),
          9000,
        ),
      ),
  );
  expect(await atDeadline(() => getEditFormInitialData(id))).toMatchObject({
    error: { name: "TimeoutError" },
  });
  expect(mockSize).toHaveBeenCalledTimes(1);
  await expect(getEditFormInitialData(id)).resolves.toMatchObject({ product: item });
});

it("keeps confirmed missing staff product distinct from a failed read", async () => {
  mockProduct.mockResolvedValueOnce(null);
  await expect(getEditFormInitialData(id)).resolves.toMatchObject({ product: null });
});

it.each(["metadata", "detail"])(
  "bounds a held live giveaway %s lookup and recovers",
  async (kind) => {
    mockProduct.mockResolvedValue(null);
    mockSpecialty.mockReturnValueOnce(held());
    const read = () =>
      kind === "metadata" ? generateMetadata({ params }) : ProductPage({ params });
    expect(await atDeadline<unknown>(read)).toMatchObject({
      error: { name: "TimeoutError" },
    });
    expect(mockSpecialty).toHaveBeenCalledTimes(1);
    mockProduct.mockResolvedValue(item);
    await expect(read()).resolves.toBeDefined();
  },
);
it("shares one budget across cached product and live giveaway reads", async () => {
  mockProduct.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
  );
  mockSpecialty.mockImplementationOnce(
    () => new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
  );
  expect(await atDeadline(() => ProductPage({ params }))).toMatchObject({
    error: { name: "TimeoutError" },
  });
  expect(mockSpecialty).toHaveBeenCalledTimes(1);
});
