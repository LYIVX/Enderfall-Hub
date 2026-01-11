import { useEffect, useMemo, useRef, useState } from "react";
import { FaChevronDown, FaChevronUp, FaTimes } from "react-icons/fa";
import { listen } from "@tauri-apps/api/event";
import { fetch as tauriFetch } from "@tauri-apps/api/http";
import { open as openDialog } from "@tauri-apps/api/dialog";
import { open as openShell } from "@tauri-apps/api/shell";
import { invoke } from "@tauri-apps/api/tauri";
import { appDataDir, join } from "@tauri-apps/api/path";
import { AuthProvider, useAuth } from "./lib/auth";
import { clearLaunchToken, writeLaunchToken } from "@enderfall/runtime";
import { applyTheme, getStoredTheme } from "@enderfall/ui";
import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from "./lib/supabase";

type ThemeMode = "galaxy" | "system" | "light" | "dark";

type Entitlement = {
  app_id: string;
  tier: string;
  active: boolean;
};

type UpdateManifest = {
  updatedAt?: string;
  apps: UpdateEntry[];
};

type UpdateEntry = {
  id: string;
  name: string;
  version: string;
  installerUrl?: string;
  releaseNotesUrl?: string;
  installerType?: "msi";
};

type AppInfo = {
  id: string;
  name: string;
  description: string;
  badge: string;
  status: string;
  tags: string[];
  icon?: string;
  iconLabel?: string;
  supportsPremium: boolean;
  installDir?: string;
  installSubdir?: string;
  exeName?: string;
  installerPath?: string | null;
  installerArgs?: string[];
};

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: "galaxy", label: "Galaxy" },
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const apps: AppInfo[] = [
  {
    id: "ftp-browser",
    name: "Ender Transfer",
    description: "Modern FTP client with previews, queues, and a clean explorer UI.",
    badge: "Desktop",
    status: "Featured",
    tags: ["Transfers", "Previews", "Queues"],
    icon: "/brand/ftp-logo.png",
    supportsPremium: true,
    installDir: "C:\\Users\\tommy\\AppData\\Local\\FTPBrowser",
    installSubdir: "PFiles\\FTPBrowser",
    exeName: "FTPBrowser.exe",
    installerPath:
      "D:\\WorkSpaces\\Enderfall\\Apps\\FTPBrowser\\src-tauri\\target\\release\\bundle\\msi\\FTPBrowser_0.1.0_x64_en-US.msi",
  },
  {
    id: "character-creation-sheet",
    name: "Character Creation",
    description: "Character atelier sheet with rich profiles, stats, and story notes.",
    badge: "Desktop",
    status: "Studio",
    tags: ["Atelier", "Sheets", "Profiles"],
    iconLabel: "CC",
    supportsPremium: true,
    installerPath: null,
  },
];

const IconChevronDown = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M6 9l6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const isTauri = typeof window !== "undefined" && "__TAURI_IPC__" in window;
const authOverrideKey = "appbrowser-auth-override";

const getOverrideTokens = () => {
  const raw = localStorage.getItem(authOverrideKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { access_token?: string; refresh_token?: string };
  } catch {
    return null;
  }
};

const hasAccess = (entitlements: Entitlement[], appId: string) =>
  entitlements.some(
    (entry) =>
      entry.active && (entry.app_id === appId || entry.app_id === "all-apps")
  );

const getStoredInstallVersion = (appId: string) =>
  localStorage.getItem(`appbrowser-install-version-${appId}`);

const setStoredInstallVersion = (appId: string, version: string) => {
  localStorage.setItem(`appbrowser-install-version-${appId}`, version);
};

const getStoredInstallDir = (appId: string) =>
  localStorage.getItem(`appbrowser-install-dir-${appId}`);

const setStoredInstallDir = (appId: string, path: string) => {
  localStorage.setItem(`appbrowser-install-dir-${appId}`, path);
};

const getInstallBaseDir = (app: AppInfo) =>
  getStoredInstallDir(app.id) || app.installDir || "";

const getInstallExePath = (app: AppInfo) => {
  const baseDir = getInstallBaseDir(app);
  if (!baseDir || !app.exeName) return null;
  const subdir = app.installSubdir ? `\\${app.installSubdir}` : "";
  return `${baseDir}${subdir}\\${app.exeName}`;
};

const getFileName = (value: string | null) => {
  if (!value) return null;
  const normalized = value.replace(/\//g, "\\");
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};

const parseVersion = (value: string) =>
  value
    .split(".")
    .map((segment) => Number(segment.replace(/[^0-9]/g, "")))
    .filter((num) => !Number.isNaN(num));

const compareVersions = (a: string, b: string) => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const lhs = left[i] ?? 0;
    const rhs = right[i] ?? 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }
  return 0;
};

const LoginModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"email-login" | "email-signup">("email-login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formInfo, setFormInfo] = useState<string | null>(null);

  const fetchWithTimeout = async (input: RequestInfo, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const signInWithPasswordFallback = async () => {
    if (!supabaseUrl || !supabaseAnonKey || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    console.log("[AppBrowser] fallback auth fetch start", supabaseUrl);
    const response = await fetchWithTimeout(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      },
      12000
    );
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    console.log("[AppBrowser] fallback auth fetch result", response.status, payload.error);
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Login failed.");
    }
    if (!payload.access_token || !payload.refresh_token) {
      throw new Error("Login failed.");
    }
    await supabase.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
    });
  };

  const tauriFetchWithTimeout = async <T,>(
    input: string,
    init: Parameters<typeof tauriFetch>[1],
    timeoutMs: number
  ) => {
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Login timed out. Check your connection and try again.")), timeoutMs);
    });
    return (await Promise.race([tauriFetch<T>(input, init), timeout])) as T;
  };

  const signInWithPasswordTauri = async () => {
    if (!supabaseUrl || !supabaseAnonKey || !supabase) {
      throw new Error("Supabase is not configured.");
    }
    console.log("[AppBrowser] tauri auth fetch start", supabaseUrl);
    const response = await tauriFetchWithTimeout<{ access_token?: string; refresh_token?: string; error?: string; error_description?: string }>(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: supabaseAnonKey,
          "Content-Type": "application/json",
        },
        body: {
          type: "Json",
          payload: { email, password },
        },
      },
      12000
    );
    const payload = response.data as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    console.log("[AppBrowser] tauri auth fetch result", response.status, payload?.error);
    if (response.status >= 400) {
      throw new Error(payload?.error_description || payload?.error || "Login failed.");
    }
    if (!payload?.access_token || !payload?.refresh_token) {
      throw new Error("Login failed.");
    }
    localStorage.setItem(
      authOverrideKey,
      JSON.stringify({ access_token: payload.access_token, refresh_token: payload.refresh_token })
    );
    window.dispatchEvent(new Event("appbrowser-auth-override-changed"));
  };

  if (!isOpen) return null;

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error("Login timed out. Check your connection and try again."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  const handleEmailLogin = async () => {
    if (!supabase) {
      setFormError("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setBusy(true);
    setFormError(null);
    setFormInfo(null);
    console.log("[AppBrowser] signInWithPassword", { email });
    try {
      if (isTauri) {
        await withTimeout(signInWithPasswordTauri(), 12000);
        setFormInfo("Login successful.");
        window.setTimeout(() => {
          onClose();
        }, 200);
        return;
      }
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        12000
      );
      console.log("[AppBrowser] signInWithPassword result", { error, session: !!data?.session });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data.session) {
        setFormInfo("Login pending. Check your email or confirm your account.");
        return;
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log("[AppBrowser] signInWithPassword exception", message);
      if (!isTauri) {
        setFormInfo("Primary login timed out. Trying fallback...");
        try {
          await signInWithPasswordFallback();
          setFormInfo(null);
          onClose();
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          setFormError(fallbackMessage);
        }
      } else {
        setFormError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignup = async () => {
    if (!supabase) {
      setFormError("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }
    setBusy(true);
    setFormError(null);
    setFormInfo(null);
    if (!username.trim()) {
      setFormError("Display name is required.");
      setBusy(false);
      return;
    }
    console.log("[AppBrowser] signUp", { email, username });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    console.log("[AppBrowser] signUp result", { error });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setFormInfo("Check your email to confirm your account.");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === "email-login" ? "Sign in" : "Create account"}</h2>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
            <FaTimes />
          </button>
        </div>
        <p className="modal-subtitle">
          Use your email to unlock premium installs and app access.
        </p>
        {!isSupabaseConfigured ? (
          <div className="form-error">
            Supabase keys missing. Configure <span>.env</span> before logging in.
          </div>
        ) : null}
        <div className="modal-form">
          {formError ? <div className="form-error">{formError}</div> : null}
          {formInfo ? <div className="form-info">{formInfo}</div> : null}
          {mode === "email-signup" ? (
            <label>
              Display name
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your name"
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
            />
          </label>
          <div className="modal-actions">
            {mode === "email-login" ? (
              <button className="primary" onClick={handleEmailLogin} disabled={busy}>
                Login
              </button>
            ) : (
              <button className="primary" onClick={handleEmailSignup} disabled={busy}>
                Create account
              </button>
            )}
            <button
              className="primary"
              onClick={() => {
                setMode((prev) => (prev === "email-login" ? "email-signup" : "email-login"));
                setFormError(null);
                setFormInfo(null);
              }}
              disabled={busy}
            >
              {mode === "email-login" ? "Need an account?" : "Back to login"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const InstallModal = ({
  app,
  isOpen,
  onClose,
  onInstall,
}: {
  app: AppInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (options: {
    installDir: string | null;
    createDesktopShortcut: boolean;
    createStartMenuShortcut: boolean;
  }) => void;
}) => {
  const [step, setStep] = useState<"location" | "shortcuts">("location");
  const [installDir, setInstallDir] = useState<string | null>(
    app ? getInstallBaseDir(app) : null
  );
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);
  const [createStartMenuShortcut, setCreateStartMenuShortcut] = useState(true);

  useEffect(() => {
    setStep("location");
    setInstallDir(app ? getInstallBaseDir(app) : null);
    setCreateDesktopShortcut(true);
    setCreateStartMenuShortcut(true);
  }, [app, isOpen]);

  if (!isOpen || !app) return null;

  const browseInstallDir = async () => {
    if (!isTauri) return;
    const selected = await openDialog({
      title: `Choose install folder for ${app.name}`,
      directory: true,
      defaultPath: installDir ?? app.installDir,
    });
    if (selected && !Array.isArray(selected)) {
      setInstallDir(selected);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>Install {app.name}</h2>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
            <FaTimes />
          </button>
        </div>
        {step === "location" ? (
          <>
            <p className="modal-subtitle">Choose where the app will be installed.</p>
            <div className="modal-form">
              <label>
                Install location
                <div className="field-row">
                  <input value={installDir ?? ""} readOnly />
                  <button className="ghost" type="button" onClick={browseInstallDir}>
                    Browse
                  </button>
                </div>
              </label>
              <div className="modal-actions">
                <button className="primary" type="button" onClick={() => setStep("shortcuts")}>
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="modal-subtitle">Choose shortcut options.</p>
            <div className="modal-form">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={createDesktopShortcut}
                  onChange={(event) => setCreateDesktopShortcut(event.target.checked)}
                />
                Add desktop shortcut
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={createStartMenuShortcut}
                  onChange={(event) => setCreateStartMenuShortcut(event.target.checked)}
                />
                Add Start Menu shortcut
              </label>
              <div className="modal-actions">
                <button className="ghost" type="button" onClick={() => setStep("location")}>
                  Back
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() =>
                    onInstall({
                      installDir,
                      createDesktopShortcut,
                      createStartMenuShortcut,
                    })
                  }
                >
                  Install
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const AppContent = () => {
  const { user, profile, isLoading, signOut } = useAuth();
  const [showLogin, setShowLogin] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [menuOpen, setMenuOpen] = useState<"file" | "edit" | "view" | "help" | null>(null);
  const menuCloseRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    getStoredTheme({
      storageKey: "appBrowserTheme",
      defaultTheme: "galaxy",
      allowed: ["galaxy", "system", "light", "dark"],
    })
  );

  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [installProgress, setInstallProgress] = useState<Record<string, number>>({});
  const [installMessage, setInstallMessage] = useState<Record<string, string>>({});
  const [installModalAppId, setInstallModalAppId] = useState<string | null>(null);
  const [appBrowserPath, setAppBrowserPath] = useState<string | null>(null);
  const [updateManifest, setUpdateManifest] = useState<UpdateManifest | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [manifestLoading, setManifestLoading] = useState(false);

  useEffect(() => {
    const isGalaxy = themeMode === "galaxy";
    document.body.classList.toggle("test-galaxy", isGalaxy);
    const dataTheme = isGalaxy ? "dark" : themeMode;
    applyTheme(dataTheme, {
      storageKey: "themeMode",
      defaultTheme: "dark",
      allowed: ["dark", "light", "system", "galaxy"],
    });
    applyTheme(themeMode, {
      storageKey: "appBrowserTheme",
      defaultTheme: "galaxy",
      allowed: ["galaxy", "system", "light", "dark"],
    });
  }, [themeMode]);

  const refreshManifest = async () => {
    const manifestUrl = (import.meta as ImportMeta).env.VITE_UPDATE_MANIFEST_URL as string | undefined;
    if (!manifestUrl) return;
    setManifestLoading(true);
    try {
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Manifest fetch failed: ${response.status}`);
      }
      const payload = (await response.json()) as UpdateManifest;
      setUpdateManifest(payload);
      setUpdateError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateError(message);
    } finally {
      setManifestLoading(false);
    }
  };

  useEffect(() => {
    refreshManifest();
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    invoke<string>("get_current_exe_path")
      .then((path) => setAppBrowserPath(path))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!updateManifest) return;
    updateManifest.apps.forEach((entry) => {
      if (installStatus[entry.id] && !getStoredInstallVersion(entry.id)) {
        setStoredInstallVersion(entry.id, entry.version);
      }
    });
  }, [updateManifest, installStatus]);

  useEffect(() => {
    if (!user) {
      setEntitlements([]);
      return;
    }

    let active = true;

    const load = async () => {
      if (isTauri) {
        const tokens = getOverrideTokens();
        const accessToken = tokens?.access_token;
        if (!accessToken || !supabaseUrl || !supabaseAnonKey) {
          setEntitlements([]);
          return;
        }
        try {
          const response = await tauriFetch<Entitlement[]>(
            `${supabaseUrl}/rest/v1/entitlements?select=app_id,tier,active&user_id=eq.${encodeURIComponent(
              user.id
            )}&active=eq.true`,
            {
              method: "GET",
              headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );
          if (!active) return;
          if (response.status >= 400) {
            console.warn("Failed to load entitlements.", response.status);
            setEntitlements([]);
            return;
          }
          setEntitlements(response.data ?? []);
        } catch (error) {
          if (!active) return;
          const message = error instanceof Error ? error.message : String(error);
          console.warn("Failed to load entitlements.", message);
          setEntitlements([]);
        }
        return;
      }

      if (!supabase) {
        setEntitlements([]);
        return;
      }

      const { data, error } = await supabase
        .from("entitlements")
        .select("app_id, tier, active")
        .eq("user_id", user.id)
        .eq("active", true);
      if (!active) return;
      if (error) {
        console.warn("Failed to load entitlements.", error.message);
        setEntitlements([]);
        return;
      }
      setEntitlements(data ?? []);
    };

    load();

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!isTauri) return;
    const syncTokens = async () => {
      if (!user) {
        await Promise.all(apps.map((app) => clearLaunchToken(app.id)));
        return;
      }
      const allowedApps = entitlements.map((entry) => entry.app_id);
      const expiresAt = Date.now() + 5 * 60 * 1000;
      await Promise.all(
        apps.map((app) =>
          writeLaunchToken({
            appId: app.id,
            userId: user.id,
            isAdmin: profile?.is_admin ?? false,
            entitlements: allowedApps,
            expiresAt,
            appBrowserPath,
          })
        )
      );
    };
    syncTokens();
    if (!user) return;
    const interval = window.setInterval(() => {
      syncTokens();
    }, 2 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [user, entitlements, profile?.is_admin, appBrowserPath]);

  const downloadUpdate = async (app: AppInfo, update: UpdateEntry) => {
    if (!isTauri || !update.installerUrl) return;
    const installDir = getInstallBaseDir(app) || app.installDir;
    if (!installDir || !app.exeName) {
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Missing install location." }));
      return;
    }
    setUpdating((prev) => ({ ...prev, [app.id]: true }));
    setInstallProgress((prev) => ({ ...prev, [app.id]: 0 }));
    setInstallMessage((prev) => ({ ...prev, [app.id]: "Downloading update..." }));
    try {
      const baseDir = await appDataDir();
      const installersDir = await join(baseDir, "Enderfall", "Installers");
      const installerPath = await invoke<string>("download_installer", {
        appId: app.id,
        url: update.installerUrl,
        destinationDir: installersDir,
      });
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Installing update..." }));
      await invoke("install_msi_payload", {
        appId: app.id,
        installerPath,
        installDir,
        exeName: app.exeName,
        appName: app.name,
        createDesktopShortcut: false,
        createStartMenuShortcut: false,
      });
      setStoredInstallVersion(app.id, update.version);
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Update installed." }));
      await refreshInstallStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInstallMessage((prev) => ({ ...prev, [app.id]: message }));
    } finally {
      setUpdating((prev) => ({ ...prev, [app.id]: false }));
    }
  };

  const updateAppBrowser = async (update: UpdateEntry) => {
    if (!isTauri || !update.installerUrl) return;
    if (!appBrowserPath) {
      setUpdateError("App Browser path not available.");
      return;
    }
    const exeName = getFileName(appBrowserPath);
    if (!exeName) {
      setUpdateError("App Browser executable name not available.");
      return;
    }
    setUpdating((prev) => ({ ...prev, [update.id]: true }));
    setInstallProgress((prev) => ({ ...prev, [update.id]: 0 }));
    setInstallMessage((prev) => ({ ...prev, [update.id]: "Downloading update..." }));
    try {
      const baseDir = await appDataDir();
      const installersDir = await join(baseDir, "Enderfall", "Installers");
      const installerPath = await invoke<string>("download_installer", {
        appId: update.id,
        url: update.installerUrl,
        destinationDir: installersDir,
      });
      setInstallMessage((prev) => ({ ...prev, [update.id]: "Installing update..." }));
      const updateDir = await join(baseDir, "Enderfall", "AppBrowser", update.version);
      await invoke("install_msi_payload", {
        appId: update.id,
        installerPath,
        installDir: updateDir,
        exeName,
        appName: "Enderfall Hub",
        createDesktopShortcut: false,
        createStartMenuShortcut: false,
      });
      setInstallMessage((prev) => ({ ...prev, [update.id]: "Update ready. Restart to use it." }));
      setStoredInstallVersion(update.id, update.version);
      await invoke("launch_path", { path: `${updateDir}\\${exeName}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateError(message);
    } finally {
      setUpdating((prev) => ({ ...prev, [update.id]: false }));
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    const unlistenPromise = listen("installer-progress", (event) => {
      const payload = event.payload as { appId?: string; progress?: number };
      if (!payload?.appId) return;
      setInstallProgress((prev) => ({
        ...prev,
        [payload.appId as string]: Math.max(0, Math.min(1, payload.progress ?? 0)),
      }));
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const checkInstalled = async () => {
      const next: Record<string, boolean> = {};
      for (const app of apps) {
        const installPath = getInstallExePath(app);
        if (!installPath) {
          next[app.id] = false;
          continue;
        }
        try {
          const exists = await invoke<boolean>("path_exists", { path: installPath });
          next[app.id] = exists;
        } catch {
          next[app.id] = false;
        }
      }
      setInstallStatus(next);
    };

    checkInstalled();
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const openMenu = (name: "file" | "edit" | "view" | "help") => {
    if (menuCloseRef.current !== null) {
      window.clearTimeout(menuCloseRef.current);
      menuCloseRef.current = null;
    }
    setMenuOpen(name);
  };

  const closeMenu = () => {
    if (menuCloseRef.current !== null) {
      window.clearTimeout(menuCloseRef.current);
    }
    menuCloseRef.current = window.setTimeout(() => {
      setMenuOpen(null);
      menuCloseRef.current = null;
    }, 150);
  };

  const displayName =
    profile?.display_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";

  const openAccount = () => {
    const url = "https://enderfall.co.uk/profile";
    if (isTauri) {
      openShell(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  const launchInstalledApp = async (app: AppInfo) => {
    if (!isTauri) return;
    const installPath = getInstallExePath(app);
    if (!installPath) return;
    await invoke("launch_path", { path: installPath });
  };

  const refreshInstallStatus = async () => {
    if (!isTauri) return;
    const next: Record<string, boolean> = {};
    for (const app of apps) {
      const installPath = getInstallExePath(app);
      if (!installPath) {
        next[app.id] = false;
        continue;
      }
      try {
        const exists = await invoke<boolean>("path_exists", { path: installPath });
        next[app.id] = exists;
      } catch {
        next[app.id] = false;
      }
    }
    setInstallStatus(next);
  };

  const startInstall = async (
    app: AppInfo,
    options: {
      installDir: string | null;
      createDesktopShortcut: boolean;
      createStartMenuShortcut: boolean;
    }
  ) => {
    if (!isTauri || !app.installerPath) return;
    const installDir = options.installDir ?? app.installDir;
    if (!installDir) {
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Missing install location." }));
      return;
    }
    setStoredInstallDir(app.id, installDir);
    setInstalling((prev) => ({ ...prev, [app.id]: true }));
    setInstallProgress((prev) => ({ ...prev, [app.id]: 0 }));
    setInstallMessage((prev) => ({ ...prev, [app.id]: "Preparing install..." }));
    try {
      await invoke("install_msi_payload", {
        appId: app.id,
        installerPath: app.installerPath,
        installDir,
        exeName: app.exeName ?? "",
        appName: app.name,
        createDesktopShortcut: options.createDesktopShortcut,
        createStartMenuShortcut: options.createStartMenuShortcut,
      });
      if (updateManifest) {
        const latest = updateManifest.apps.find((entry) => entry.id === app.id);
        if (latest?.version) {
          setStoredInstallVersion(app.id, latest.version);
        }
      }
      setInstallProgress((prev) => ({ ...prev, [app.id]: 1 }));
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Install complete." }));
      await refreshInstallStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInstallMessage((prev) => ({ ...prev, [app.id]: message }));
    } finally {
      setInstalling((prev) => ({ ...prev, [app.id]: false }));
    }
  };

  const appCards = useMemo(
    () =>
      apps.map((app) => {
        const isAdmin = profile?.is_admin ?? false;
        const entitled = !!user && (isAdmin || hasAccess(entitlements, app.id));
        const premiumLocked = app.supportsPremium && !entitled;
        const isInstalled = installStatus[app.id] ?? false;
        const canInstall = Boolean(app.installerPath);
        const installPath = getInstallExePath(app);
        const installedVersion = getStoredInstallVersion(app.id);
        const updateInfo = updateManifest?.apps.find((entry) => entry.id === app.id);
        const updateAvailable =
          !!installedVersion &&
          !!updateInfo?.version &&
          compareVersions(updateInfo.version, installedVersion) > 0;
        return {
          app,
          entitled,
          premiumLocked,
          isInstalled,
          canInstall,
          installPath,
          progress: installProgress[app.id] ?? 0,
          isInstalling: installing[app.id] ?? false,
          message: installMessage[app.id],
          installedVersion,
          updateInfo,
          updateAvailable,
        };
      }),
    [
      entitlements,
      installStatus,
      installProgress,
      installing,
      installMessage,
      user,
      profile,
      updateManifest,
    ]
  );

  return (
    <div className="page">
      <div className="stars" />

      <header className="main-header">
        <div className="header-left">
          <div className="brand">
            <img src="/brand/enderfall-mark.png" alt="Enderfall" className="logo" />
            <div>
              <div className="brand-name">Enderfall</div>
              <div className="tagline">Galaxy tools for creators</div>
            </div>
          </div>
          <div className="menu-bar">
            <div className="menu-group" onMouseEnter={() => openMenu("file")} onMouseLeave={closeMenu}>
              <button className="menu-button" type="button">
                File
              </button>
              {menuOpen === "file" ? (
                <div className="menu-popover" onMouseEnter={() => openMenu("file")} onMouseLeave={closeMenu}>
                  <button className="menu-item" type="button" onClick={() => window.location.reload()}>
                    Refresh apps
                  </button>
                  <div className="menu-divider" />
                  <button className="menu-item" type="button" onClick={() => setShowLogin(true)}>
                    Open login
                  </button>
                </div>
              ) : null}
            </div>
            <div className="menu-group" onMouseEnter={() => openMenu("edit")} onMouseLeave={closeMenu}>
              <button className="menu-button" type="button">
                Edit
              </button>
              {menuOpen === "edit" ? (
                <div className="menu-popover" onMouseEnter={() => openMenu("edit")} onMouseLeave={closeMenu}>
                  <button
                    className="menu-item"
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(window.location.href)}
                  >
                    Copy hub link
                  </button>
                </div>
              ) : null}
            </div>
            <div className="menu-group" onMouseEnter={() => openMenu("view")} onMouseLeave={closeMenu}>
              <button className="menu-button" type="button">
                View
              </button>
              {menuOpen === "view" ? (
                <div className="menu-popover" onMouseEnter={() => openMenu("view")} onMouseLeave={closeMenu}>
                  <div className="menu-item has-submenu" role="button" tabIndex={0}>
                    <span>Theme</span>
                    <span className="menu-sub-caret">
                      <IconChevronDown />
                    </span>
                    <div className="menu-sub">
                      {themeOptions.map((item) => (
                        <button
                          key={item.value}
                          className="menu-item"
                          type="button"
                          onClick={() => setThemeMode(item.value)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="menu-group" onMouseEnter={() => openMenu("help")} onMouseLeave={closeMenu}>
              <button className="menu-button" type="button">
                Help
              </button>
              {menuOpen === "help" ? (
                <div className="menu-popover" onMouseEnter={() => openMenu("help")} onMouseLeave={closeMenu}>
                  <button className="menu-item" type="button" onClick={() => window.open("https://enderfall.co.uk", "_blank")}>
                    About Enderfall
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="actions">
          {!isLoading && user ? (
            <div className="user-section" ref={dropdownRef} data-open={showDropdown ? "true" : "false"}>
              <button
                className="user-button"
                onClick={() => setShowDropdown((prev) => !prev)}
                type="button"
              >
                <span className="avatar">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={displayName} />
                  ) : (
                    <span className="avatar-fallback">{displayName.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
                <span className="user-name">{displayName}</span>
                <span className="chevron" aria-hidden="true">
                  {showDropdown ? <FaChevronUp /> : <FaChevronDown />}
                </span>
              </button>
              <div className="dropdown" data-open={showDropdown ? "true" : "false"}>
                <button className="dropdown-item" type="button" onClick={openAccount}>
                  Profile
                </button>
                <button className="dropdown-item" type="button" onClick={() => signOut()}>
                  Logout
                </button>
              </div>
            </div>
          ) : (
            <button className="primary" onClick={() => setShowLogin(true)}>
              Login
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <div className="hero-top">
          <div className="hero-copy">
            <p className="kicker">Enderfall App Hub</p>
            <h1>Launch your galaxy toolkit in one place.</h1>
            <p className="subhead">
              Install and launch your desktop apps from a single home base.
            </p>
          </div>
          <div className="hero-actions">
            <button className="cta-ghost" onClick={() => setShowLogin(true)}>
              {user ? "Manage account" : "Login for Premium"}
            </button>
          </div>
        </div>
        <div className="hero-highlights">
          <div>
            <span className="highlight-label">Premium builds</span>
            <span className="highlight-value">Desktop installs</span>
          </div>
          <div>
            <span className="highlight-label">Themes</span>
            <span className="highlight-value">Galaxy + System</span>
          </div>
          <div>
            <span className="highlight-label">Library</span>
            <span className="highlight-value">Unified launch</span>
          </div>
        </div>
      </section>

      {!isTauri ? (
        <div className="card-note">
          Desktop features require the Tauri build. Installers and launch actions are disabled in the browser.
        </div>
      ) : null}

      {updateManifest ? (
        <section className="updates">
          <div className="updates-header">
            <div>
              <h2>Updates</h2>
              <p>
                Latest releases from GitHub
                {updateManifest.updatedAt ? ` · Updated ${updateManifest.updatedAt}` : ""}.
              </p>
            </div>
            <button className="ghost" type="button" onClick={refreshManifest} disabled={manifestLoading}>
              {manifestLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="updates-grid">
            {updateManifest.apps.map((entry) => {
              const app = apps.find((item) => item.id === entry.id);
              const installedVersion = getStoredInstallVersion(entry.id);
              const updateAvailable =
                installedVersion && compareVersions(entry.version, installedVersion) > 0;
              const isAppBrowser = entry.id === "app-browser";
              return (
                <div className="update-card" key={entry.id}>
                  <div className="update-meta">
                    <div className="update-title">{entry.name}</div>
                    <div className="update-versions">
                      <span>Installed: {installedVersion ?? "Unknown"}</span>
                      <span>Latest: {entry.version}</span>
                    </div>
                  </div>
                  <div className="update-actions">
                    {entry.releaseNotesUrl ? (
                      <button className="ghost" type="button" onClick={() => openShell(entry.releaseNotesUrl!)}>
                        Release notes
                      </button>
                    ) : null}
                    {isAppBrowser && entry.installerUrl && updateAvailable ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={updating[entry.id]}
                        onClick={() => updateAppBrowser(entry)}
                      >
                        {updating[entry.id] ? "Updating..." : "Update"}
                      </button>
                    ) : app && entry.installerUrl && updateAvailable ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={updating[entry.id]}
                        onClick={() => downloadUpdate(app, entry)}
                      >
                        {updating[entry.id] ? "Updating..." : "Update"}
                      </button>
                    ) : (
                      <button className="ghost" type="button" disabled>
                        {updateAvailable ? "Unavailable" : "Up to date"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {updateManifest.apps.length === 0 ? (
              <div className="card-note">No updates available.</div>
            ) : null}
          </div>
        </section>
      ) : updateError ? (
        <div className="card-note">Failed to load updates: {updateError}</div>
      ) : null}

      <section className="grid">
        {appCards.map(({ app, entitled, premiumLocked, isInstalled, canInstall, installPath, progress, isInstalling, message, updateAvailable }) => (
          <article className="app-card" key={app.id}>
            <div className="card-row">
              {app.icon ? (
                <img src={app.icon} alt={app.name} className="card-icon" />
              ) : (
                <div className="card-icon fallback">{app.iconLabel ?? app.name.slice(0, 2)}</div>
              )}
              <div className="card-content">
                <div className="badge-row">
                  <span className="badge">{app.badge}</span>
                  <span className="badge-alt">{app.status}</span>
                </div>
                <h3>{app.name}</h3>
                <p>{app.description}</p>
                <div className="tag-row">
                  {app.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="card-actions">
              {isInstalled ? (
                <button
                  className="primary"
                  onClick={() => launchInstalledApp(app)}
                  disabled={!isTauri || premiumLocked}
                >
                  Open app
                </button>
              ) : (
                <button
                  className="ghost"
                  onClick={() => setInstallModalAppId(app.id)}
                  disabled={!isTauri || premiumLocked || !canInstall || isInstalling}
                >
                  Install
                </button>
              )}
              {updateAvailable ? <span className="badge-alt">Update available</span> : null}
              {app.supportsPremium && !entitled ? (
                <button className="locked" onClick={() => setShowLogin(true)}>
                  Premium locked
                </button>
              ) : null}
            </div>
            {isInstalling ? (
              <div className="progress">
                <div className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            ) : null}
            {message ? <div className="card-note">{message}</div> : null}
            {!installPath ? (
              <div className="card-note">Installer not available yet.</div>
            ) : null}
            {premiumLocked ? (
              <div className="card-note">Premium access required for desktop installs.</div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="footer-band">
        <div>
          <h2>Need a custom tool?</h2>
          <p>We build bespoke tooling for studios, creators, and game communities.</p>
        </div>
        <button className="cta-primary" onClick={() => window.open("https://enderfall.co.uk/contact", "_blank")}>
          Contact the team
        </button>
      </section>

      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />
      <InstallModal
        app={installModalAppId ? apps.find((item) => item.id === installModalAppId) ?? null : null}
        isOpen={!!installModalAppId}
        onClose={() => setInstallModalAppId(null)}
        onInstall={(options) => {
          const app = apps.find((item) => item.id === installModalAppId);
          if (app) {
            void startInstall(app, options);
          }
          setInstallModalAppId(null);
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
