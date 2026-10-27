let handler: (r: Request) => Promise<Response>;
(globalThis as any).Deno = { serve: (h: any) => { handler = h; }, env: { get: (k: string) => (k.includes("URL") ? "http://x" : "k") } };
await import("./capture-under-test.ts");
const base = "http://localhost/functions/v1/capture/one";
let fails = 0;
async function check(label: string, req: Request, status: number, expectKey?: [string, unknown]) {
  const res = await handler(req); const body = await res.json();
  const ok = res.status === status && (!expectKey || body[expectKey[0]] === expectKey[1]);
  if (!ok) fails++;
  console.log(ok ? "ok  " : "FAIL", label, res.status, JSON.stringify(body));
}
const post = (url: string, init: RequestInit & { headers?: Record<string, string> }) => new Request(url, { method: "POST", ...init });
await check("GET rejected", new Request(base), 405);
await check("no secret", post(base, { headers: { "content-type": "application/json" }, body: "{}" }), 401);
await check("wrong secret", post(base, { headers: { "content-type": "application/json", "x-capture-secret": "bad" }, body: '{"mobile":"9811122233"}' }), 401);
await check("missing slug", post("http://localhost/functions/v1/capture", { headers: { "x-capture-secret": "s" }, body: "{}" }), 400);
await check("bad content type", post(base, { headers: { "content-type": "text/plain", "x-capture-secret": "s" }, body: "hello" }), 400);
await check("json capture", post(base, { headers: { "content-type": "application/json", "x-capture-secret": "s" }, body: '{"contact":"Test One","mobile":"9811122233","category":"Yes"}' }), 200, ["status", "processed"]);
await check("bearer header works", post(base, { headers: { "content-type": "application/json", authorization: "Bearer s" }, body: '{"contact":"Test Two","mobile":"9811122244"}' }), 200, ["status", "processed"]);
await check("form capture", post(base, { headers: { "content-type": "application/x-www-form-urlencoded", "x-capture-secret": "s" }, body: "contact=Test+Three&mobile=9811122255" }), 200, ["status", "processed"]);
await check("retry ignored", post(base, { headers: { "content-type": "application/json", "x-capture-secret": "s" }, body: '{"contact":"Test One","mobile":"9811122233","category":"Yes"}' }), 200, ["status", "duplicate_delivery"]);
await check("re-enquiry via form", post(base, { headers: { "content-type": "application/x-www-form-urlencoded", "x-capture-secret": "s" }, body: "contact=Test+One&mobile=%2B91+98111+22233" }), 200, ["reenquiry", true]);
console.log(fails ? `${fails} FAILED` : "HTTP LAYER PASSED");
process.exit(fails ? 1 : 0);
