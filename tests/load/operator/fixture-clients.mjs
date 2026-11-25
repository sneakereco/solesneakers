// Service-role credentials stay in this operator process. Workers receive only
// customer sessions and phase credentials.
export function createFixtureClients({ admin, db, control, runId }) {
  const accounts = {
    async ensure(data) {
      const existing = await admin.auth.admin.getUserById(data.id);
      let user = existing.data?.user;
      if (user) {
        if (user.app_metadata?.load_test_run !== runId || user.email !== data.email)
          throw Error("Unrelated auth user cannot be adopted");
      } else {
        if (
          existing.error &&
          !["user_not_found", "user_not_found_by_id"].includes(existing.error.code) &&
          existing.error.status !== 404
        )
          throw Error("Auth lookup failed");
        const result = await admin.auth.admin.createUser({
          id: data.id,
          email: data.email,
          password: data.password,
          email_confirm: true,
          app_metadata: { load_test_run: runId },
          user_metadata: { full_name: "Load Buyer" },
        });
        if (result.error || !result.data.user)
          throw Error("Synthetic account creation failed");
        user = result.data.user;
      }
      const profile = await db.query(
        "select role,email from public.profiles where id=$1",
        [data.id],
      );
      if (
        profile.rows[0] &&
        (profile.rows[0].role !== "customer" || profile.rows[0].email !== data.email)
      )
        throw Error("Unrelated profile cannot be adopted");
      await db.query(
        "insert into public.profiles(id,email,full_name,role) values($1,$2,'Load Buyer','customer') on conflict(id) do nothing",
        [data.id, data.email],
      );
      return data;
    },
  };
  const catalog = {
    async ensure(data) {
      await db.query("begin");
      try {
        const existing = (
          await db.query("select name from public.products where id=$1", [data.id])
        ).rows[0];
        if (existing) {
          if (existing.name !== data.name)
            throw Error("Unrelated catalog cannot be adopted");
          await db.query("commit");
          return data;
        }
        const tenant = (
          await db.query("select id from public.tenants order by id limit 2")
        ).rows;
        if (tenant.length !== 1)
          throw Error("Load fixtures require the deployed single-store schema");
        const owner = tenant[0].id;
        await db.query(
          "insert into public.tag_brands(id,canonical_label) values($1,$2)",
          [data.brandId, `Load ${runId} ${data.id}`],
        );
        await db.query(
          "insert into public.tag_sizes(id,size_type,canonical_label) values($1,'none',$2)",
          [data.sizeId, `Load ${data.id}`],
        );
        await db.query(
          "insert into public.products(id,tenant_id,name,condition,category,brand_id,size_type,shipping_price_cents,is_active,go_live_at) values($1,$2,$3,'new','accessories',$4,'none',1000,true,now()-interval '1 hour')",
          [data.id, owner, data.name, data.brandId],
        );
        await db.query(
          "insert into public.product_variants(id,tenant_id,product_id,size_id,sku,sale_price_cents,stock) values($1,$2,$3,$4,$5,$6,$7)",
          [
            data.variantId,
            owner,
            data.id,
            data.sizeId,
            data.sku,
            data.priceCents,
            data.stock,
          ],
        );
        await db.query(
          "insert into public.product_images(id,product_id,url,is_primary) values($1,$2,'/images/logo.png',true)",
          [data.imageId, data.id],
        );
        await db.query("commit");
        return data;
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    },
  };
  return {
    accounts,
    catalog,
    register: (fixtures) => control("fixtures", { runId, fixtures }),
  };
}
