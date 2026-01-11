import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __appBrowserSupabase: SupabaseClient | undefined;
}

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const isTauri = typeof window !== "undefined" && "__TAURI_IPC__" in window;

if (!isSupabaseConfigured) {
  console.warn("Missing Supabase environment variables.");
}

const tauriFetchAdapter: typeof fetch = async (input, init) => {
  if (!isTauri) {
    return fetch(input, init);
  }

  const { fetch: tauriFetch } = await import("@tauri-apps/api/http");
  const url = typeof input === "string" ? input : input.url;
  const method = init?.method ?? "GET";
  const headers = Object.fromEntries(new Headers(init?.headers).entries());
  let body: { type: "Json" | "Text"; payload: any } | undefined;

  if (init?.body && typeof init.body === "string") {
    const contentType = headers["content-type"] || headers["Content-Type"] || "";
    if (contentType.includes("application/json")) {
      try {
        body = { type: "Json", payload: JSON.parse(init.body) };
      } catch {
        body = { type: "Text", payload: init.body };
      }
    } else {
      body = { type: "Text", payload: init.body };
    }
  }

  const response = await tauriFetch(url, { method, headers, body });
  const responseHeaders = new Headers();
  if (response.headers) {
    Object.entries(response.headers).forEach(([key, value]) => {
      responseHeaders.set(key, String(value));
    });
  }

  const data = response.data;
  const responseBody = typeof data === "string" ? data : data ? JSON.stringify(data) : "";
  return new Response(responseBody, { status: response.status, headers: responseHeaders });
};

const createSupabaseClient = () =>
  createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: !isTauri,
      autoRefreshToken: !isTauri,
      detectSessionInUrl: !isTauri,
      storageKey: "appbrowser-auth",
      lock: !isTauri,
    },
    global: {
      fetch: tauriFetchAdapter,
    },
  });

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? (globalThis.__appBrowserSupabase ?? (globalThis.__appBrowserSupabase = createSupabaseClient()))
  : null;
