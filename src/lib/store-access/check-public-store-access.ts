import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { logError } from "@/lib/utils/log";

type PublicStoreAccess =
  | { allowed: true }
  | { allowed: false; status: 423 | 503; error: string };

export async function checkPublicStoreAccess({
  fresh = false,
} = {}): Promise<PublicStoreAccess> {
  try {
    const access = await getStoreAccessSettings({ fresh });
    if (access) {
      return access.isSiteLocked
        ? {
            allowed: false,
            status: 423,
            error: "The storefront is locked. Customer registration is unavailable.",
          }
        : { allowed: true };
    }
  } catch (error) {
    logError(error, { layer: "auth", event: "public_store_access_lookup_failed" });
  }
  return {
    allowed: false,
    status: 503,
    error: "Store access is temporarily unavailable. Please try again later.",
  };
}
