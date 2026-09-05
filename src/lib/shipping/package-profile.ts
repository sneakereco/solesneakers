export type PackageProfileItem = {
  quantity?: number | null;
  category?: string | null;
};

export type ShippingPackageDefaults = {
  weight: number;
  length: number;
  width: number;
  height: number;
};

export type PackageProfile = ShippingPackageDefaults;

const FALLBACK_PACKAGE: PackageProfile = {
  weight: 16,
  length: 12,
  width: 12,
  height: 12,
};

export function buildPackageProfile(
  items: PackageProfileItem[],
  defaults: Record<string, ShippingPackageDefaults>,
): PackageProfile {
  if (items.length === 0) {
    return { ...FALLBACK_PACKAGE };
  }

  return items.reduce<PackageProfile>(
    (profile, item) => {
      const configured = item.category ? defaults[item.category] : undefined;
      const parcel = configured ?? FALLBACK_PACKAGE;
      const quantity = Math.max(1, Number(item.quantity ?? 0));

      return {
        weight: profile.weight + parcel.weight * quantity,
        length: Math.max(profile.length, parcel.length),
        width: Math.max(profile.width, parcel.width),
        height: Math.max(profile.height, parcel.height),
      };
    },
    { weight: 0, length: 0, width: 0, height: 0 },
  );
}
