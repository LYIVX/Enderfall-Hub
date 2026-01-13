import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { fetch as tauriFetch } from "@tauri-apps/api/http";
import { clearLaunchToken, clearProfileCache } from "@enderfall/runtime";
import { supabase, supabaseAnonKey, supabaseUrl } from "./supabase";

export type WebProfile = {
  display_name: string | null;
  avatar_url: string | null;
  is_admin?: boolean;
};

type AuthContextValue = {
  user: User | null;
  profile: WebProfile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const isTauri = typeof window !== "undefined" && "__TAURI_IPC__" in window;
const authOverrideKey = "appbrowser-auth-override";
const entitlementsCacheKey = "appbrowser-entitlements-cache";

const decodeJwt = (token: string) => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, "="));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const buildFallbackProfile = (payload: Record<string, unknown> | null, email?: string | null) => {
  const userMeta = (payload?.user_metadata as Record<string, unknown> | undefined) ?? undefined;
  const displayName =
    (userMeta?.full_name as string | undefined) ??
    (userMeta?.username as string | undefined) ??
    (email ? email.split("@")[0] : null);
  const avatarUrl = (userMeta?.avatar_url as string | undefined) ?? null;
  const isAdmin = (userMeta?.is_admin as boolean | undefined) ?? false;
  return { display_name: displayName ?? null, avatar_url: avatarUrl, is_admin: isAdmin };
};

const fetchProfile = async (userId: string) => {
  if (!supabase) return null;
  const fromWebProfiles = async (column: "id" | "user_id") => {
    const { data, error } = await supabase
      .from("web_profiles")
      .select("display_name, avatar_url, is_admin")
      .eq(column, userId)
      .maybeSingle();
    if (error) {
      console.warn("Failed to load web profile.", error.message);
      return null;
    }
    return data ?? null;
  };
  return (await fromWebProfiles("id")) ?? (await fromWebProfiles("user_id"));
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<WebProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    const data = await fetchProfile(user.id);
    setProfile(data);
  };

  useEffect(() => {
    let active = true;

    const fetchProfileTauri = async (
      userId: string,
      accessToken: string,
      payload: Record<string, unknown> | null,
      email?: string | null
    ) => {
      if (!supabaseUrl || !supabaseAnonKey) {
        return buildFallbackProfile(payload, email);
      }
      try {
        const fetchWebProfile = async (column: "id" | "user_id") => {
          const response = await tauriFetch<WebProfile[]>(
            `${supabaseUrl}/rest/v1/web_profiles?select=display_name,avatar_url,is_admin&${column}=eq.${encodeURIComponent(
              userId
            )}&limit=1`,
            {
              method: "GET",
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );
          return response.status >= 400 ? null : response.data?.[0] ?? null;
        };
        const webProfile =
          (await fetchWebProfile("id")) ?? (await fetchWebProfile("user_id"));

        const needsAdmin =
          !webProfile || webProfile.is_admin === undefined || webProfile.is_admin === null;
        const needsAvatar = !webProfile || !webProfile.avatar_url;
        const needsDisplay = !webProfile || !webProfile.display_name;

        if (needsAdmin || needsAvatar || needsDisplay) {
          const fetchProfileRow = async (column: "id" | "user_id") => {
            const profileResponse = await tauriFetch<
              { username?: string | null; avatar_url?: string | null; is_admin?: boolean | null }[]
            >(
              `${supabaseUrl}/rest/v1/profiles?select=username,avatar_url,is_admin&${column}=eq.${encodeURIComponent(
                userId
              )}&limit=1`,
              {
                method: "GET",
                headers: {
                  apikey: supabaseAnonKey,
                  Authorization: `Bearer ${accessToken}`,
                  Accept: "application/json",
                },
              }
            );
            return profileResponse.status >= 400
              ? null
              : profileResponse.data?.[0] ?? null;
          };
          const profileRow =
            (await fetchProfileRow("id")) ?? (await fetchProfileRow("user_id"));

          return {
            display_name:
              webProfile?.display_name ??
              profileRow?.username ??
              buildFallbackProfile(payload, email).display_name,
            avatar_url:
              webProfile?.avatar_url ??
              profileRow?.avatar_url ??
              buildFallbackProfile(payload, email).avatar_url,
            is_admin:
              (webProfile?.is_admin ?? profileRow?.is_admin) ??
              buildFallbackProfile(payload, email).is_admin,
          };
        }

        return webProfile;
      } catch {
        return buildFallbackProfile(payload, email);
      }
    };

    const applyOverride = async () => {
      if (!isTauri) return;
      const raw = localStorage.getItem(authOverrideKey);
      if (raw) {
        try {
          const { access_token, refresh_token } = JSON.parse(raw) as {
            access_token?: string;
            refresh_token?: string;
          };
          if (access_token) {
            const payload = decodeJwt(access_token);
            const id = payload?.sub as string | undefined;
            const email = payload?.email as string | undefined;
            if (id) {
              if (supabase && refresh_token) {
                try {
                  await supabase.auth.setSession({
                    access_token,
                    refresh_token,
                  });
                } catch {
                  // ignore session sync failures
                }
              }
              const userMetadata =
                (payload?.user_metadata as Record<string, unknown> | undefined) ?? {};
              const appMetadata =
                (payload?.app_metadata as Record<string, unknown> | undefined) ?? {};
              setUser({
                id,
                email: email ?? null,
                app_metadata: appMetadata,
                user_metadata: userMetadata,
                aud: "authenticated",
                created_at: "",
              } as User);
              const nextProfile = await fetchProfileTauri(id, access_token, payload, email);
              if (active) {
                setProfile(nextProfile);
              }
              return;
            }
          }
        } catch {
          // ignore malformed override
        }
      }
      setUser(null);
      setProfile(null);
    };

    const load = async () => {
      if (isTauri) {
        await applyOverride();
        if (active) setIsLoading(false);
        return;
      }
      if (!supabase) {
        if (active) setIsLoading(false);
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;
      setUser(session?.user ?? null);
      if (session?.user) {
        setProfile(await fetchProfile(session.user.id));
      }
      setIsLoading(false);
    };

    load();

    if (isTauri) {
      const handleOverride = () => {
        void applyOverride();
      };
      window.addEventListener("appbrowser-auth-override-changed", handleOverride);
      return () => {
        active = false;
        window.removeEventListener("appbrowser-auth-override-changed", handleOverride);
      };
    }

    const subscription = supabase
      ? supabase.auth.onAuthStateChange(async (_event, session) => {
          if (!active) return;
          setUser(session?.user ?? null);
          if (session?.user) {
            setProfile(await fetchProfile(session.user.id));
          } else {
            setProfile(null);
          }
        })
      : null;

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    if (isTauri) {
      localStorage.removeItem(authOverrideKey);
      localStorage.removeItem(entitlementsCacheKey);
      await clearLaunchToken("enderfall-hub");
      await clearProfileCache();
      setUser(null);
      setProfile(null);
      window.dispatchEvent(new Event("appbrowser-auth-override-changed"));
      return;
    }
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const value = useMemo(
    () => ({
      user,
      profile,
      isLoading,
      signOut,
      refreshProfile,
    }),
    [user, profile, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
