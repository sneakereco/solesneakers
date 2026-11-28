// Shards change scheduling only. Unsharded commands retain their full coverage.
export function selectCheckoutShard(checks, flags, faultFlag) {
  const shardFlags = flags.filter((flag) => flag.startsWith("--shard="));
  if (
    new Set(flags).size !== flags.length ||
    shardFlags.length > 1 ||
    flags.some((flag) => flag !== faultFlag && !/^--shard=[1-4]\/4$/.test(flag))
  ) {
    throw Error(
      "Unexpected checkout " +
        (faultFlag === "--break-cart" ? "browser" : "database") +
        " arguments",
    );
  }
  const shard = shardFlags.length ? Number(shardFlags[0][8]) : null;
  if (flags.includes(faultFlag) && shard !== null && shard !== 1)
    throw Error("The deliberate fault control belongs to shard 1");
  return checks
    .filter(([owner]) => shard === null || owner === shard)
    .map(([, ...check]) => check);
}
