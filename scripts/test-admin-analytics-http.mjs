import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ownedFixture } from "./analytics-test-fixture.mjs";

const fixture = ownedFixture();
const db = (sql) => fixture.sql("admin_analytics_sdd", sql);
const docker = (args, env = process.env) =>
  execFileSync("docker", args, { encoding: "utf8", env }).trim();
const label = "codex.task=admin-analytics-sdd-8119061f";
const suffix = randomBytes(6).toString("hex");
const role = "analytics_fixture_" + suffix;
const network = "analytics-fixture-" + suffix;
const anotherSize = randomUUID(),
  anotherVariant = randomUUID();
const secret = randomBytes(40).toString("hex");
const password = randomBytes(32).toString("hex");
const [tenant, brand, size, product, variant, customer, staff, order, line] = Array.from(
  { length: 9 },
  () => randomUUID(),
);
const image = docker([
  "image",
  "inspect",
  "--format",
  "{{.Id}}",
  "public.ecr.aws/supabase/postgrest:v16.2",
]);
assert.match(image, /^sha256:[a-f0-9]{64}$/);
let networkId,
  helper,
  attached = false,
  seeded = false;
function token(dbRole, sub) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({ role: dbRole, sub, exp: Math.floor(Date.now() / 1000) + 300 });
  return content + "." + createHmac("sha256", secret).update(content).digest("base64url");
}
try {
  db(`begin;
    create role ${role} login noinherit password '${password}';
    grant anon,authenticated,service_role to ${role};
    insert into public.tenants(id,name) values('${tenant}','HTTP fixture');
    insert into auth.users(id) values('${customer}'),('${staff}');
    insert into public.profiles(id,role,tenant_id) values('${customer}','customer','${tenant}'),('${staff}','admin','${tenant}');
    insert into public.tag_brands(id,canonical_label) values('${brand}','Fixture ${suffix}');
    insert into public.tag_sizes(id,canonical_label,size_type) values('${size}','${suffix}','shoe');
    insert into public.tag_sizes(id,canonical_label,size_type) values('${anotherSize}','S-${suffix}','shoe');
    insert into public.products(id,tenant_id,name,category,condition,brand_id,size_type)
      values('${product}','${tenant}','HTTP fixture','sneakers','new','${brand}','shoe');
    insert into public.product_variants(id,tenant_id,product_id,size_id,sku,stock,sale_price_cents,unit_cost_cents,unit_cost_recorded)
      values('${variant}','${tenant}','${product}','${size}','${suffix}',3,2500,1234,true);
    insert into public.orders(id,user_id,subtotal,shipping,total) values('${order}','${customer}',25,0,25);
    insert into public.order_items(id,order_id,product_id,variant_id,quantity,unit_price,line_total,unit_cost)
      values('${line}','${order}','${product}','${variant}',1,25,25,9.87);
    commit;`);
  seeded = true;
  networkId = docker(["network", "create", "--label", label, network]);
  docker(["network", "connect", "--alias", "analytics-db", networkId, fixture.id]);
  attached = true;
  helper = docker(
    [
      "run",
      "--detach",
      "--pull=never",
      "--name",
      network,
      "--label",
      label,
      "--network",
      networkId,
      "-p",
      "127.0.0.1::3000",
      "-e",
      "PGRST_DB_URI",
      "-e",
      "PGRST_JWT_SECRET",
      "-e",
      "PGRST_DB_ANON_ROLE=anon",
      image,
    ],
    {
      ...process.env,
      PGRST_DB_URI: `postgres://${role}:${password}@analytics-db/admin_analytics_sdd`,
      PGRST_JWT_SECRET: secret,
    },
  );
  const binding = docker(["port", helper, "3000/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const base = "http://" + binding;
  const call = (path, jwt, options = {}) =>
    fetch(base + "/" + path, {
      ...options,
      headers: {
        ...(jwt ? { Authorization: "Bearer " + jwt } : {}),
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(2000),
    });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await call("product_variants?select=id&limit=0")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  assert(ready, "PostgREST did not become ready");
  const customerJwt = token("authenticated", customer),
    staffJwt = token("authenticated", staff),
    serviceJwt = token("service_role", staff);
  const json = async (path, jwt) => {
    const res = await call(path, jwt);
    assert.equal(res.status, 200);
    return res.json();
  };
  for (const jwt of [null, customerJwt]) {
    assert.deepEqual(
      await json("product_variants?select=id,sale_price_cents&id=eq." + variant, jwt),
      [{ id: variant, sale_price_cents: 2500 }],
    );
    assert(
      [401, 403].includes(
        (await call("product_variants?select=id,unit_cost_cents", jwt)).status,
      ),
    );
  }
  assert.deepEqual(
    await json("order_items?select=id,unit_price&id=eq." + line, customerJwt),
    [{ id: line, unit_price: 25 }],
  );
  assert.deepEqual(
    await json(
      "order_items?select=id&id=eq." + line,
      token("authenticated", randomUUID()),
    ),
    [],
  );
  assert.equal((await call("order_items?select=unit_cost", customerJwt)).status, 403);
  assert.deepEqual(await json("order_items?select=unit_cost&id=eq." + line, serviceJwt), [
    { unit_cost: 9.87 },
  ]);
  assert.deepEqual(
    await json(
      "product_variants?select=unit_cost_cents,unit_cost_recorded&id=eq." + variant,
      serviceJwt,
    ),
    [{ unit_cost_cents: 1234, unit_cost_recorded: true }],
  );
  const update = (jwt) =>
    call("product_variants?id=eq." + variant + "&select=id", jwt, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ unit_cost_cents: 0, unit_cost_recorded: true }),
    });
  assert.deepEqual(await (await update(customerJwt)).json(), []);
  const staffUpdate = await update(staffJwt);
  assert.equal(staffUpdate.status, 200);
  assert.deepEqual(await staffUpdate.json(), [{ id: variant }]);
  assert.deepEqual(
    await json(
      "product_variants?select=unit_cost_cents,unit_cost_recorded&id=eq." + variant,
      serviceJwt,
    ),
    [{ unit_cost_cents: 0, unit_cost_recorded: true }],
  );
  const write = {
    id: anotherVariant,
    tenant_id: tenant,
    product_id: product,
    size_id: anotherSize,
    sku: "HTTP-" + suffix,
    stock: 0,
    sale_price_cents: 1700,
    unit_cost_cents: 0,
    unit_cost_recorded: false,
  };
  const create = (jwt) =>
    call("product_variants?select=id", jwt, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(write),
    });
  assert.equal((await create(customerJwt)).status, 403);
  const inserted = await create(staffJwt);
  assert.equal(inserted.status, 201);
  assert.deepEqual(await inserted.json(), [{ id: anotherVariant }]);
  assert.deepEqual(
    await json(
      "product_variants?select=unit_cost_cents,unit_cost_recorded&id=eq." +
        anotherVariant,
      serviceJwt,
    ),
    [{ unit_cost_cents: 0, unit_cost_recorded: false }],
  );
  const removed = await call(
    "product_variants?id=eq." + anotherVariant + "&select=id",
    staffJwt,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), [{ id: anotherVariant }]);
  console.log(
    "PASS PostgREST public catalog, customer own-order scope, distinct historical/current costs and session staff write",
    JSON.stringify({ image, helper, networkId, binding }),
  );
} finally {
  if (helper) docker(["rm", "-f", helper]);
  if (attached) docker(["network", "disconnect", networkId, fixture.id]);
  if (networkId) docker(["network", "rm", networkId]);
  if (seeded)
    db(`begin;
    delete from public.order_items where id='${line}';
    delete from public.orders where id='${order}';
    delete from public.product_variants where id in ('${variant}','${anotherVariant}');
    delete from public.products where id='${product}';
    delete from public.tag_sizes where id in ('${size}','${anotherSize}');
    delete from public.tag_brands where id='${brand}';
    delete from auth.users where id in ('${customer}','${staff}');
    delete from public.tenants where id='${tenant}';
    drop role ${role}; commit;`);
}
