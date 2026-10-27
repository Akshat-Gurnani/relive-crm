// Test stand-in for @supabase/supabase-js: rpc() calls the local test database as service_role.
import pg from "pg";
export function createClient(_url: string, _key: string, _opts: unknown) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      const c = new pg.Client({ host: "127.0.0.1", user: "postgres", password: "localtest", database: "crm_test" });
      await c.connect();
      try {
        await c.query("set role service_role");
        const keys = Object.keys(args);
        const res = await c.query(`select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`,
          keys.map((k) => (typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
        return { data: res.rows[0].r, error: null };
      } catch (e: any) {
        return { data: null, error: { code: e.code, message: e.message } };
      } finally { await c.end(); }
    },
  };
}
