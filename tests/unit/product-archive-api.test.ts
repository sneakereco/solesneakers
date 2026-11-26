jest.mock("next/cache", () => ({
  revalidateTag: jest.fn(),
}));

jest.mock("@/lib/auth/session", () => ({
  requireAdminApi: jest.fn(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock("@/lib/auth/tenant", () => ({
  ensureTenantId: jest.fn(),
}));

const archiveProductsByIdsMock = jest.fn();
const archiveProductsByFiltersMock = jest.fn();
const restoreProductsByIdsMock = jest.fn();
const restoreProductsByFiltersMock = jest.fn();
const deleteProductsByIdsMock = jest.fn();
const deleteProductsByFiltersMock = jest.fn();
const lookupInventoryProductMock = jest.fn();
const listProductsMock = jest.fn(),
  deleteProductMock = jest.fn();
const archiveProductMock = jest.fn();
const restoreProductMock = jest.fn();

jest.mock("@/services/product-service", () => ({
  ProductService: jest.fn().mockImplementation(() => ({
    archiveProductsByIds: archiveProductsByIdsMock,
    archiveProductsByFilters: archiveProductsByFiltersMock,
    restoreProductsByIds: restoreProductsByIdsMock,
    restoreProductsByFilters: restoreProductsByFiltersMock,
    deleteProductsByIds: deleteProductsByIdsMock,
    deleteProductsByFilters: deleteProductsByFiltersMock,
    archiveProduct: archiveProductMock,
    listProducts: listProductsMock,
    lookupInventoryProduct: lookupInventoryProductMock,
    deleteProduct: deleteProductMock,
    restoreProduct: restoreProductMock,
    getProductById: jest.fn(),
    updateProduct: jest.fn(),
  })),
}));

import { NextRequest } from "next/server";

import { requireAdminApi } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/auth/tenant";

import {
  GET as listProducts,
  PATCH as bulkPatch,
} from "../../src/app/api/admin/products/route";
import {
  DELETE as deleteItem,
  PATCH as itemPatch,
} from "../../src/app/api/admin/products/[id]/route";

const mockRequireAdminApi = jest.mocked(requireAdminApi);
const mockCreateSupabaseServerClient = jest.mocked(createSupabaseServerClient);
const mockEnsureTenantId = jest.mocked(ensureTenantId);

describe("product archive admin api", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAdminApi.mockResolvedValue({
      user: { id: "user-1", email: "admin@example.com" },
      profile: null,
      role: "admin",
    } as never);
    mockCreateSupabaseServerClient.mockResolvedValue({ from: jest.fn() } as never);
    mockEnsureTenantId.mockResolvedValue("tenant-1");
  });

  it.each([{ exactSku: "000123" }, { exactId: "11111111-1111-4111-8111-111111111111" }])(
    "routes exact inventory identities through the authenticated tenant",
    async (identity) => {
      lookupInventoryProductMock.mockResolvedValue(null);
      const query = new URLSearchParams(
        Object.entries(identity).map(([key, value]) => [key, String(value)]),
      );
      query.set("tenantId", "other-tenant");
      const response = await listProducts(
        new NextRequest("https://shop.test/api/admin/products?" + query),
      );
      expect(mockRequireAdminApi).toHaveBeenCalled();
      expect(mockEnsureTenantId).toHaveBeenCalled();
      expect(lookupInventoryProductMock).toHaveBeenCalledWith("tenant-1", identity);
      expect(listProductsMock).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ product: null });
    },
  );
  it("returns the exact identity result and sibling SKUs", async () => {
    const product = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Fixture",
      archived_at: null,
      variants: [{ sku: "000123" }, { sku: "000124" }],
    };
    lookupInventoryProductMock.mockResolvedValue(product);
    const response = await listProducts(
      new NextRequest("https://shop.test/api/admin/products?exactSku=000123"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ product });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("does not read inventory when the admin gate rejects", async () => {
    mockRequireAdminApi.mockRejectedValueOnce(new Error("admin access denied"));
    const response = await listProducts(
      new NextRequest("https://shop.test/api/admin/products?exactSku=000123"),
    );
    expect(response.ok).toBe(false);
    expect(lookupInventoryProductMock).not.toHaveBeenCalled();
    expect(mockEnsureTenantId).not.toHaveBeenCalled();
  });
  it("does not turn a failed exact inventory read into absence", async () => {
    lookupInventoryProductMock.mockRejectedValue(new Error("unavailable"));
    const response = await listProducts(
      new NextRequest("https://shop.test/api/admin/products?exactSku=000123"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("product");
  });
  it("does not admit an ambiguous exact identity or fall through to the list", async () => {
    const response = await listProducts(
      new NextRequest(
        "https://shop.test/api/admin/products?exactSku=123&exactId=11111111-1111-4111-8111-111111111111",
      ),
    );
    expect(response.status).toBe(400);
    expect(lookupInventoryProductMock).not.toHaveBeenCalled();
    expect(listProductsMock).not.toHaveBeenCalled();
  });
  it("passes the ordinary paginated name search to the authenticated tenant inventory", async () => {
    const data = { products: [], total: 103, page: 2, limit: 100 };
    listProductsMock.mockResolvedValue(data);
    const response = await listProducts(
      new NextRequest(
        "https://shop.test/api/admin/products?q=Fixture+product&stockStatus=all&includeOutOfStock=1&searchMode=inventory&limit=100&page=2",
      ),
    );
    expect(mockRequireAdminApi).toHaveBeenCalled();
    expect(mockEnsureTenantId).toHaveBeenCalled();
    expect(listProductsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "Fixture product",
        page: 2,
        limit: 100,
        stockStatus: "all",
        includeOutOfStock: true,
        searchMode: "inventory",
        tenantId: "tenant-1",
      }),
    );
    expect(await response.json()).toEqual(data);
  });
  it.each([false, true])(
    "returns an explicit archive outcome (%s) for a successful delete",
    async (archived) => {
      deleteProductMock.mockResolvedValue({ archived });
      const id = "11111111-1111-1111-8111-111111111111";
      const response = await deleteItem(
        new NextRequest("https://shop.test/api/admin/products/" + id, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id }) },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, archived });
      expect(deleteProductMock).toHaveBeenCalledWith(id);
    },
  );
  it("bulk archives selected product ids", async () => {
    archiveProductsByIdsMock.mockResolvedValue({ archivedCount: 2 });

    const response = await bulkPatch(
      new Request("http://localhost/api/admin/products", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-1",
        },
        body: JSON.stringify({
          action: "archive",
          selectionMode: "ids",
          ids: [
            "11111111-1111-1111-8111-111111111111",
            "22222222-2222-2222-8222-222222222222",
          ],
        }),
      }) as never,
    );

    expect(archiveProductsByIdsMock).toHaveBeenCalledWith(
      ["11111111-1111-1111-8111-111111111111", "22222222-2222-2222-8222-222222222222"],
      "tenant-1",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      archivedCount: 2,
      requestId: "req-1",
    });
  });

  it("bulk archives all matching filtered products", async () => {
    archiveProductsByFiltersMock.mockResolvedValue({ archivedCount: 12 });

    const response = await bulkPatch(
      new Request("http://localhost/api/admin/products", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-2",
        },
        body: JSON.stringify({
          action: "archive",
          selectionMode: "filtered",
          filters: {
            q: "jordan",
            stockStatus: "in_stock",
          },
        }),
      }) as never,
    );

    expect(archiveProductsByFiltersMock).toHaveBeenCalledWith("tenant-1", {
      q: "jordan",
      category: undefined,
      condition: undefined,
      stockStatus: "in_stock",
    });
    expect(response.status).toBe(200);
  });

  it("bulk restores all matching filtered products", async () => {
    restoreProductsByFiltersMock.mockResolvedValue({ restoredCount: 7 });

    const response = await bulkPatch(
      new Request("http://localhost/api/admin/products", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-restore",
        },
        body: JSON.stringify({
          action: "restore",
          selectionMode: "filtered",
          filters: {
            q: "retro",
            stockStatus: "archived",
          },
        }),
      }) as never,
    );

    expect(restoreProductsByFiltersMock).toHaveBeenCalledWith("tenant-1", {
      q: "retro",
      category: undefined,
      condition: undefined,
      stockStatus: "archived",
    });
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      restoredCount: 7,
      requestId: "req-restore",
    });
  });

  it("archives a single product through the item patch route", async () => {
    archiveProductMock.mockResolvedValue({ archived: true });

    const response = await itemPatch(
      new NextRequest("http://localhost/api/admin/products/product-1?action=archive", {
        method: "PATCH",
        headers: { "x-request-id": "req-3" },
      }),
      {
        params: Promise.resolve({ id: "11111111-1111-1111-8111-111111111111" }),
      },
    );

    expect(archiveProductMock).toHaveBeenCalledWith(
      "11111111-1111-1111-8111-111111111111",
      "tenant-1",
    );
    expect(response.status).toBe(200);
  });

  it("bulk deletes all matching filtered products", async () => {
    deleteProductsByFiltersMock.mockResolvedValue({ deletedCount: 5, failedCount: 1 });

    const response = await bulkPatch(
      new Request("http://localhost/api/admin/products", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-5",
        },
        body: JSON.stringify({
          action: "delete",
          selectionMode: "filtered",
          filters: {
            q: "archived",
            stockStatus: "archived",
          },
        }),
      }) as never,
    );

    expect(deleteProductsByFiltersMock).toHaveBeenCalledWith("tenant-1", {
      q: "archived",
      category: undefined,
      condition: undefined,
      stockStatus: "archived",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deletedCount: 5,
      failedCount: 1,
      requestId: "req-5",
    });
  });

  it("restores a single product through the item patch route", async () => {
    restoreProductMock.mockResolvedValue({ restored: true });

    const response = await itemPatch(
      new NextRequest("http://localhost/api/admin/products/product-1?action=restore", {
        method: "PATCH",
        headers: { "x-request-id": "req-4" },
      }),
      {
        params: Promise.resolve({ id: "11111111-1111-1111-8111-111111111111" }),
      },
    );

    expect(restoreProductMock).toHaveBeenCalledWith(
      "11111111-1111-1111-8111-111111111111",
      "tenant-1",
    );
    expect(response.status).toBe(200);
  });
});
