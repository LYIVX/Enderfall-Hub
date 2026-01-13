import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { FaDownload, FaSyncAlt, FaTimes, FaTrashAlt } from "react-icons/fa";

import { listen } from "@tauri-apps/api/event";

import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";

import { open as openDialog } from "@tauri-apps/api/dialog";

import { open as openShell } from "@tauri-apps/api/shell";

import { invoke } from "@tauri-apps/api/tauri";

import { createDir, writeBinaryFile } from "@tauri-apps/api/fs";
import { appDataDir, join, localDataDir } from "@tauri-apps/api/path";

import { AuthProvider, useAuth } from "./lib/auth";

import {
  clearLaunchToken,
  readLaunchToken,
  readSharedPreferences,
  writeAppBrowserPath,
  writeLaunchToken,
  writeProfileCache,
  writeSharedPreferences,
  type LaunchToken,
} from "@enderfall/runtime";

import { Button, Dropdown, Input, MainHeader, Panel, PreferencesModal, StackedCard, Toggle, applyTheme, getStoredTheme } from "@enderfall/ui";

import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from "./lib/supabase";



type ThemeMode = "galaxy" | "system" | "light" | "plain-light" | "plain-dark";

type HubPreferences = {
  openOnStartup: boolean;
  closeToTray: boolean;
  minimizeToTray: boolean;
};



type Entitlement = {

  app_id: string;

  tier: string;

  active: boolean;

};

type EntitlementsCache = {
  userId: string;
  entitlements: Entitlement[];
  isAdmin: boolean;
  updatedAt: number;
};



type GithubReleaseAsset = {

  name: string;

  browser_download_url: string;

};



type GithubRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft?: boolean;
  published_at: string | null;
  assets: GithubReleaseAsset[];
};


type ReleaseInfo = {

  id: string;

  name: string;

  version: string;

  installerUrl?: string;

  releaseNotesUrl?: string;

  installerType?: "msi" | "exe";
  prerelease?: boolean;

  notes?: string | null;

};



type InstallerAssetPattern = {
  pattern: string;
  type: "msi" | "exe";
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

  cardGradient?: string;

  installSubdir?: string;

  exeName?: string;

  devWorkspaceDir?: string;

  devCommand?: string[];

  installerArgs?: string[];

  repoOwner?: string;

  repoName?: string;

  installerAssetPatterns?: InstallerAssetPattern[];

  installerAssetPattern?: string;

  installerType?: "msi" | "exe";

};



const themeOptions: { value: ThemeMode; label: string }[] = [

  { value: "system", label: "System (Default)" },

  { value: "galaxy", label: "Galaxy (Dark)" },

  { value: "light", label: "Galaxy (Light)" },

  { value: "plain-light", label: "Plain Light" },

  { value: "plain-dark", label: "Plain Dark" },

];



const isTauri = typeof window !== "undefined" && "__TAURI_IPC__" in window;

const devRoot = ((import.meta as ImportMeta).env.VITE_DEV_ROOT as string | undefined) ?? "";


const getInstallerPatterns = (app: AppInfo): InstallerAssetPattern[] => {
  if (app.installerAssetPatterns && app.installerAssetPatterns.length > 0) {
    return app.installerAssetPatterns;
  }
  if (app.installerAssetPattern) {
    return [{ pattern: app.installerAssetPattern, type: app.installerType ?? "msi" }];
  }
  return [
    { pattern: "\\.exe$", type: "exe" },
    { pattern: "\\.msi$", type: "msi" },
  ];
};

const selectInstallerAsset = (app: AppInfo, release: GithubRelease) => {
  const patterns = getInstallerPatterns(app);
  for (const entry of patterns) {
    const matcher = new RegExp(entry.pattern, "i");
    const installer = release.assets.find((asset) => matcher.test(asset.name));
    if (installer) {
      return { installer, installerType: entry.type };
    }
  }
  return { installer: undefined, installerType: app.installerType ?? "msi" };
};

const buildDefaultInstallerArgs = (installDir: string) => ["/S", `/D=${installDir}`];

const buildInstallerArgs = (app: AppInfo, installDir: string) => {
  if (app.installerArgs && app.installerArgs.length > 0) {
    return app.installerArgs.map((arg) => arg.replace("{installDir}", installDir));
  }
  return buildDefaultInstallerArgs(installDir);
};



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

    cardGradient:
      "linear-gradient(135deg, #00e5ff, #7c4dff, #ff4dd2, #ffb74d)",

    installSubdir: "PFiles\\Ender Transfer",

    exeName: "Ender Transfer.exe",

    devWorkspaceDir: devRoot ? `${devRoot}\\Enderfall\\Apps` : undefined,

    devCommand: ["pnpm", "--filter", "ftpbrowser", "dev"],

    repoOwner: "LYIVX",

    repoName: "Ender_Transfer",

    installerAssetPatterns: [
      { pattern: "^Ender_Transfer_.*\\.exe$", type: "exe" },
      { pattern: "^Ender_Transfer_.*\\.msi$", type: "msi" },
    ],

  },

  {

    id: "character-creation-sheet",

    name: "Character Creation",

    description: "Character atelier sheet with rich profiles, stats, and story notes.",

    badge: "Desktop",

    status: "Studio",

    tags: ["Atelier", "Sheets", "Profiles"],

    icon: "/brand/character-creation.png",

    supportsPremium: true,

    cardGradient:

      "linear-gradient(135deg, #ff86c8, #e255a1, #c03b84)",

    installSubdir: "PFiles\\Character Creation",

    exeName: "Character Creation.exe",

    devWorkspaceDir: devRoot ? `${devRoot}\\Enderfall\\Apps` : undefined,

    devCommand: ["pnpm", "--filter", "character-atelier-sheet", "dev"],

    repoOwner: "LYIVX",

    repoName: "Ender-Character-Creation",

    installerAssetPatterns: [
      { pattern: "^CharacterCreation_.*\\.exe$", type: "exe" },
      { pattern: "^CharacterCreation_.*\\.msi$", type: "msi" },
    ],

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



const authOverrideKey = "appbrowser-auth-override";
const entitlementsCacheKey = "appbrowser-entitlements-cache";



const getOverrideTokens = () => {

  const raw = localStorage.getItem(authOverrideKey);

  if (!raw) return null;

  try {

    return JSON.parse(raw) as { access_token?: string; refresh_token?: string };

  } catch {

    return null;

  }

};

const readEntitlementsCache = (userId: string): EntitlementsCache | null => {
  const raw = localStorage.getItem(entitlementsCacheKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EntitlementsCache;
    if (!parsed || parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeEntitlementsCache = (userId: string, entitlements: Entitlement[], isAdmin: boolean) => {
  const payload: EntitlementsCache = {
    userId,
    entitlements,
    isAdmin,
    updatedAt: Date.now(),
  };
  localStorage.setItem(entitlementsCacheKey, JSON.stringify(payload));
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



const getResolvedInstallBaseDir = (app: AppInfo, fallbackDir?: string) =>

  getStoredInstallDir(app.id) || fallbackDir || "";



const getResolvedInstallExePath = (app: AppInfo, fallbackDir?: string) => {

  const baseDir = getResolvedInstallBaseDir(app, fallbackDir);

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



const prereleaseStorageKey = (appId: string) => `appbrowser-prerelease-${appId}`;



const getStoredPrerelease = (appId: string) =>

  typeof window === "undefined" ? false : localStorage.getItem(prereleaseStorageKey(appId)) === "true";



const setStoredPrerelease = (appId: string, value: boolean) => {

  localStorage.setItem(prereleaseStorageKey(appId), String(value));

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



const normalizeVersion = (tag: string) => (tag.startsWith("v") ? tag.slice(1) : tag);



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

        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "email-login") {
              handleEmailLogin();
            } else {
              handleEmailSignup();
            }
          }}
        >

          {formError ? <div className="form-error">{formError}</div> : null}

          {formInfo ? <div className="form-info">{formInfo}</div> : null}

          {mode === "email-signup" ? (

            <label>

              Display name

              <Input

                value={username}

                onChange={(event) => setUsername(event.target.value)}

                placeholder="Your name"

              />

            </label>

          ) : null}

          <label>

            Email

            <Input

              type="email"
              autoComplete="username"

              value={email}

              onChange={(event) => setEmail(event.target.value)}

              placeholder="you@example.com"

            />

          </label>

          <label>

            Password

            <Input

              type="password"
              autoComplete={mode === "email-login" ? "current-password" : "new-password"}

              value={password}

              onChange={(event) => setPassword(event.target.value)}

              placeholder="password"

            />

          </label>

          <div className="modal-actions">

            {mode === "email-login" ? (

              <button className="primary" type="submit" disabled={busy}>

                Login

              </button>

            ) : (

              <button className="primary" type="submit" disabled={busy}>

                Create account

              </button>

            )}

            <button

              className="primary"
              type="button"

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

        </form>

      </div>

    </div>

  );

};



const InstallModal = ({
  app,
  isOpen,
  onClose,
  onInstall,
  defaultInstallDir,
  prereleaseEnabled,
  onPrereleaseChange,
  releaseInfo,
}: {
  app: AppInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (options: {
    installDir: string | null;
    createDesktopShortcut: boolean;
    createStartMenuShortcut: boolean;
  }) => void;
  defaultInstallDir?: string;
  prereleaseEnabled: boolean;
  onPrereleaseChange: (value: boolean) => void;
  releaseInfo?: ReleaseInfo;
}) => {
  const [step, setStep] = useState<"location" | "shortcuts">("location");
  const [installDir, setInstallDir] = useState<string | null>(
    app ? getResolvedInstallBaseDir(app, defaultInstallDir) : null
  );
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);
  const [createStartMenuShortcut, setCreateStartMenuShortcut] = useState(true);
  const [includePrerelease, setIncludePrerelease] = useState(prereleaseEnabled);

  useEffect(() => {
    setStep("location");
    setInstallDir(app ? getResolvedInstallBaseDir(app, defaultInstallDir) : null);
    setCreateDesktopShortcut(true);
    setCreateStartMenuShortcut(true);
    setIncludePrerelease(prereleaseEnabled);
  }, [app, defaultInstallDir, isOpen, prereleaseEnabled]);


  if (!isOpen || !app) return null;



  const browseInstallDir = async () => {

    if (!isTauri) return;

    const selected = await openDialog({

      title: `Choose install folder for ${app.name}`,

      directory: true,

      defaultPath: installDir ?? defaultInstallDir,

    });

    if (selected && !Array.isArray(selected)) {

      setInstallDir(selected);

    }

  };



  return (

    <div className="modal-backdrop" onClick={onClose}>

      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>
            Install {app.name} {releaseInfo?.version ? `v${releaseInfo.version}` : ""}
          </h2>
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
                  <Input value={installDir ?? ""} readOnly />
                  <button className="ghost" type="button" onClick={browseInstallDir}>
                    Browse
                  </button>
                </div>
              </label>
              <Toggle
                checked={includePrerelease}
                onChange={(event) => {
                  const nextValue = event.target.checked;
                  setIncludePrerelease(nextValue);
                  onPrereleaseChange(nextValue);
                }}
                label="Include pre-release builds"
              />
              {includePrerelease ? (
                <div className="form-info">Pre-release builds may be unstable.</div>
              ) : null}
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

              <Toggle
                checked={createDesktopShortcut}
                onChange={(event) => setCreateDesktopShortcut(event.target.checked)}
                label="Add desktop shortcut"
              />

              <Toggle
                checked={createStartMenuShortcut}
                onChange={(event) => setCreateStartMenuShortcut(event.target.checked)}
                label="Add Start Menu shortcut"
              />

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



const ReleaseNotesModal = ({

  isOpen,

  title,

  notes,

  onClose,

}: {

  isOpen: boolean;

  title: string;

  notes: string | null;

  onClose: () => void;

}) => {

  if (!isOpen) return null;

  return (

    <div className="modal-backdrop" onClick={onClose}>

      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()}>

        <div className="modal-header">

          <h2>{title}</h2>

          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">

            <FaTimes />

          </button>

        </div>

        <p className="modal-subtitle">Release notes from GitHub.</p>

        <div className="release-notes">

          {notes ? <pre>{notes}</pre> : <div className="card-note">Loading release notes...</div>}

        </div>

      </div>

    </div>

  );

};



const DownloadsModal = ({

  isOpen,

  items,

  updates,

  onClose,

  onUpdate,

}: {

  isOpen: boolean;

  items: Array<{ id: string; name: string; progress: number; message?: string }>;

  updates: Array<{ id: string; name: string }>;

  onClose: () => void;

  onUpdate: (id: string) => void;

}) => {

  if (!isOpen) return null;

  return (

    <div className="modal-backdrop" onClick={onClose}>

      <div className="modal" onClick={(event) => event.stopPropagation()}>

        <div className="modal-header">

          <h2>Downloads</h2>

          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">

            <FaTimes />

          </button>

        </div>

        {updates.length > 0 ? (

          <div className="download-section">

            <div className="download-title">Updates available</div>

            {updates.map((update) => (

              <div className="download-row" key={update.id}>

                <span>{update.name}</span>

                <Button variant="warning" type="button" onClick={() => onUpdate(update.id)}>

                  Update

                </Button>

              </div>

            ))}

          </div>

        ) : null}

        <div className="download-section">

          <div className="download-title">Active downloads</div>

          {items.length === 0 ? (

            <div className="card-note">No active downloads.</div>

          ) : (

            items.map((item) => (

              <div className="download-row" key={item.id}>

                <div className="download-meta">

                  <span>{item.name}</span>

                  {item.message ? <span className="card-note">{item.message}</span> : null}

                </div>

                <div className="progress mini">

                  <div className="progress-bar" style={{ width: `${Math.round(item.progress * 100)}%` }} />

                </div>

              </div>

            ))

          )}

        </div>

      </div>

    </div>

  );

};



const AppContent = () => {

  const { user, profile, isLoading, signOut } = useAuth();

  const [showLogin, setShowLogin] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState<"file" | "edit" | "view" | "help" | null>(null);

  const menuCloseRef = useRef<number | null>(null);



  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>

    getStoredTheme({

      storageKey: "appBrowserTheme",

      defaultTheme: "system",

      allowed: ["galaxy", "system", "light", "plain-light", "plain-dark"],

    })

  );

  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [hubPreferences, setHubPreferences] = useState<HubPreferences>({
    openOnStartup: true,
    closeToTray: true,
    minimizeToTray: true,
  });

  const sharedThemeUpdatedAtRef = useRef<number>(0);
  const sharedThemeApplyRef = useRef<ThemeMode | null>(null);
  const sharedAnimationsApplyRef = useRef<boolean | null>(null);
  const sharedThemeAllowed = useMemo(
    () => new Set<ThemeMode>(["system", "galaxy", "light", "plain-light", "plain-dark"]),
    []
  );



  const loadHubPreferences = async () => {
    if (!isTauri) return;
    try {
      const prefs = await invoke<HubPreferences>("get_hub_preferences");
      setHubPreferences(prefs);
    } catch {
      // Ignore missing preferences.
    }
  };

  const updateHubPreferences = async (update: Partial<HubPreferences>) => {
    if (!isTauri) return;
    try {
      const prefs = await invoke<HubPreferences>("set_hub_preferences", {
        update: {
          openOnStartup: update.openOnStartup,
          closeToTray: update.closeToTray,
          minimizeToTray: update.minimizeToTray,
        },
      });
      setHubPreferences(prefs);
    } catch {
      // Ignore failed preference updates.
    }
  };

  useEffect(() => {
    void loadHubPreferences();
  }, []);

  useEffect(() => {
    if (!preferencesOpen) return;
    void loadHubPreferences();
  }, [preferencesOpen]);

  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);
  const [tokenSnapshot, setTokenSnapshot] = useState<LaunchToken | null>(null);
  const [cachedAdmin, setCachedAdmin] = useState<boolean | null>(null);

  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});

  const [devStatus, setDevStatus] = useState<Record<string, boolean>>({});

  const [installing, setInstalling] = useState<Record<string, boolean>>({});

  const [installProgress, setInstallProgress] = useState<Record<string, number>>({});

  const [installMessage, setInstallMessage] = useState<Record<string, string>>({});

  const [installModalAppId, setInstallModalAppId] = useState<string | null>(null);

  const [defaultInstallDirs, setDefaultInstallDirs] = useState<Record<string, string>>({});

  const [showDownloads, setShowDownloads] = useState(false);

  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);

  const [releaseNotesTitle, setReleaseNotesTitle] = useState("Release notes");

  const [releaseNotesBody, setReleaseNotesBody] = useState<string | null>(null);

  const [appBrowserPath, setAppBrowserPath] = useState<string | null>(null);

  const [releaseInfoByApp, setReleaseInfoByApp] = useState<Record<string, ReleaseInfo>>({});
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [prereleasePrefs, setPrereleasePrefs] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};

    apps.forEach((app) => {

      next[app.id] = getStoredPrerelease(app.id);

    });

    return next;
  });
  const setPrereleasePreference = (appId: string, value: boolean) => {
    setStoredPrerelease(appId, value);
    setPrereleasePrefs((prev) => ({ ...prev, [appId]: value }));
  };

  const cacheAvatar = async (avatarUrl: string | null, userId: string) => {
    if (!isTauri || !avatarUrl) return null;
    if (!avatarUrl.startsWith("http")) return null;
    try {
      const baseDir = await localDataDir();
      const avatarDir = await join(baseDir, "Enderfall", "Avatars");
      await createDir(avatarDir, { recursive: true });

      const parsed = new URL(avatarUrl);
      const fileName = parsed.pathname.split("/").pop() || "avatar.png";
      const extension = fileName.includes(".") ? fileName.split(".").pop() : "png";
      const safeExt = extension && extension.length <= 6 ? extension : "png";
      const avatarPath = await join(avatarDir, `${userId}.${safeExt}`);

      try {
        const response = await tauriFetch<number[]>(avatarUrl, {
          method: "GET",
          responseType: ResponseType.Binary,
          headers: {
            Accept: "image/*",
            "User-Agent": "Mozilla/5.0",
          },
        });
        if (response.status < 400 && response.data) {
          const bytes = Uint8Array.from(response.data);
          await writeBinaryFile({ path: avatarPath, contents: bytes });
          return avatarPath;
        }
      } catch {
        // fall through to browser fetch
      }

      if (typeof window !== "undefined" && window.fetch) {
        const res = await fetch(avatarUrl, { credentials: "omit" });
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        await writeBinaryFile({ path: avatarPath, contents: bytes });
        return avatarPath;
      }

      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    let active = true;

    const loadToken = async () => {
      const token = await readLaunchToken("enderfall-hub");
      if (!active) return;
      if (token && token.expiresAt > Date.now()) {
        setTokenSnapshot(token);
        return;
      }
      setTokenSnapshot(null);
    };

    loadToken();
    const interval = window.setInterval(loadToken, 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);


  useEffect(() => {
    if (!isTauri) return;
    let active = true;
    readSharedPreferences()
      .then((prefs) => {
        if (!active || !prefs) return;
        const updatedAt = prefs.updatedAt ?? 0;
        sharedThemeUpdatedAtRef.current = updatedAt;
        if (prefs.themeMode) {
          const nextTheme = prefs.themeMode as ThemeMode;
          if (sharedThemeAllowed.has(nextTheme) && nextTheme !== themeMode) {
            sharedThemeApplyRef.current = nextTheme;
            setThemeMode(nextTheme);
          }
        }
        if (typeof prefs.animationsEnabled === "boolean") {
          if (prefs.animationsEnabled !== animationsEnabled) {
            sharedAnimationsApplyRef.current = prefs.animationsEnabled;
            setAnimationsEnabled(prefs.animationsEnabled);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyResolvedTheme = () => {
      const resolvedTheme =
        themeMode === "system" ? (media.matches ? "galaxy" : "light") : themeMode;
      const isGalaxy = resolvedTheme === "galaxy";
      const isLight = resolvedTheme === "light";
      document.documentElement.setAttribute("data-theme", resolvedTheme);
      document.body.classList.toggle("ef-galaxy", isGalaxy);
      document.body.classList.toggle("ef-galaxy-light", isLight);
    };

    const persistTheme = (storageKey: string) => {
      if (themeMode === "system") {
        localStorage.setItem(storageKey, "system");
        return;
      }
      applyTheme(themeMode, {
        storageKey,
        defaultTheme: "system",
        allowed: ["galaxy", "system", "light", "plain-light", "plain-dark"],
      });
    };

    persistTheme("themeMode");
    persistTheme("appBrowserTheme");

    applyResolvedTheme();
    if (themeMode !== "system") return;
    const handler = () => applyResolvedTheme();
    if ("addEventListener" in media) {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.setAttribute(
      "data-reduce-motion",
      animationsEnabled ? "false" : "true"
    );
  }, [animationsEnabled]);



  useEffect(() => {
    if (!isTauri) return;
    if (sharedThemeApplyRef.current === themeMode) {
      sharedThemeApplyRef.current = null;
      return;
    }
    if (!sharedThemeAllowed.has(themeMode)) return;
    writeSharedPreferences({ themeMode })
      .then((prefs) => {
        if (prefs?.updatedAt) sharedThemeUpdatedAtRef.current = prefs.updatedAt;
      })
      .catch(() => undefined);
  }, [themeMode, sharedThemeAllowed]);

  useEffect(() => {
    if (!isTauri) return;
    if (sharedAnimationsApplyRef.current === animationsEnabled) {
      sharedAnimationsApplyRef.current = null;
      return;
    }
    writeSharedPreferences({ animationsEnabled })
      .then((prefs) => {
        if (prefs?.updatedAt) sharedThemeUpdatedAtRef.current = prefs.updatedAt;
      })
      .catch(() => undefined);
  }, [animationsEnabled]);

  useEffect(() => {
    if (!isTauri) return;
    const interval = window.setInterval(async () => {
      try {
        const prefs = await readSharedPreferences();
        if (!prefs) return;
        const updatedAt = prefs.updatedAt ?? 0;
        if (updatedAt <= sharedThemeUpdatedAtRef.current) return;
        sharedThemeUpdatedAtRef.current = updatedAt;
        if (prefs.themeMode) {
          const nextTheme = prefs.themeMode as ThemeMode;
          if (sharedThemeAllowed.has(nextTheme) && nextTheme !== themeMode) {
            sharedThemeApplyRef.current = nextTheme;
            setThemeMode(nextTheme);
          }
        }
        if (typeof prefs.animationsEnabled === "boolean") {
          if (prefs.animationsEnabled !== animationsEnabled) {
            sharedAnimationsApplyRef.current = prefs.animationsEnabled;
            setAnimationsEnabled(prefs.animationsEnabled);
          }
        }
      } catch {
        // ignore poll failures
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [themeMode, sharedThemeAllowed]);

  const refreshReleases = async (force = false) => {
    const failures: string[] = [];
    const next: Record<string, ReleaseInfo> = {};
    const githubToken = (import.meta as ImportMeta).env.VITE_GITHUB_TOKEN as string | undefined;
    await Promise.all(
      apps.map(async (app) => {
        if (!app.repoOwner || !app.repoName) return;
        const includePrerelease = prereleasePrefs[app.id] ?? getStoredPrerelease(app.id);
        const cacheKey = `appbrowser-releases-${app.repoOwner}-${app.repoName}`;
        const cachedRaw = localStorage.getItem(cacheKey);
        let releases: GithubRelease[] | null = null;
        if (!force && cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw) as { fetchedAt: number; releases: GithubRelease[] };
            if (Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
              releases = cached.releases;
            }
          } catch {
            // ignore cache parse errors
          }
        }
        try {
          if (!releases) {
            const response = await fetch(
              `https://api.github.com/repos/${app.repoOwner}/${app.repoName}/releases?per_page=10`,
              {
                cache: "no-store",
                headers: {
                  Accept: "application/vnd.github+json",
                  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
                },
              }
            );
            if (!response.ok) {
              if (response.status === 403 && cachedRaw) {
                try {
                  const cached = JSON.parse(cachedRaw) as { fetchedAt: number; releases: GithubRelease[] };
                  releases = cached.releases;
                } catch {
                  throw new Error(`${app.name} (${response.status})`);
                }
              } else {
                throw new Error(`${app.name} (${response.status})`);
              }
            } else {
              const payload = (await response.json()) as GithubRelease[];
              releases = payload;
              localStorage.setItem(
                cacheKey,
                JSON.stringify({ fetchedAt: Date.now(), releases: payload })
              );
            }
          }
          if (!releases) return;
          const candidates = releases.filter((entry) => !entry.draft);
          const preferred = includePrerelease
            ? candidates.filter((entry) => entry.prerelease)
            : candidates.filter((entry) => !entry.prerelease);
          const fallback = includePrerelease ? candidates.filter((entry) => !entry.prerelease) : [];
          let selectedRelease: GithubRelease | undefined;
          let installer: GithubReleaseAsset | undefined;
          let installerType: "msi" | "exe" = app.installerType ?? "msi";

          const pickInstaller = (entries: GithubRelease[]) => {
            for (const entry of entries) {
              const selected = selectInstallerAsset(app, entry);
              if (selected.installer) {
                selectedRelease = entry;
                installer = selected.installer;
                installerType = selected.installerType;
                return true;
              }
            }
            return false;
          };

          if (!pickInstaller(preferred)) {
            pickInstaller(fallback);
          }

          if (!selectedRelease) {
            return;
          }

          next[app.id] = {
            id: app.id,
            name: selectedRelease.name ?? app.name,
            version: normalizeVersion(selectedRelease.tag_name),
            installerUrl: installer?.browser_download_url,
            releaseNotesUrl: selectedRelease.html_url,
            installerType,
            prerelease: selectedRelease.prerelease,
            notes: selectedRelease.body ?? null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(message);
        }
      })
    );
    setReleaseInfoByApp(next);
    if (failures.length) {
      const extra =
        githubToken || !failures.some((entry) => entry.includes("(403)"))
          ? ""
          : " Add VITE_GITHUB_TOKEN in .env.local to avoid rate limits.";
      setReleaseError(`${failures.join(", ")}${extra}`);
    } else {
      setReleaseError(null);
    }
  };


  const [isRefreshing, setIsRefreshing] = useState(false);



  const refreshAll = async () => {

    if (isRefreshing) return;

    setIsRefreshing(true);

    try {

      await refreshReleases(true);
      await refreshInstallStatus();

    } finally {

      setIsRefreshing(false);

    }

  };



  useEffect(() => {
    refreshReleases();
  }, [prereleasePrefs]);


  useEffect(() => {

    if (!isTauri) return;

    void refreshInstallStatus();

  }, []);



  useEffect(() => {

    if (!isTauri) return;

    invoke<string>("get_current_exe_path")

      .then((path) => setAppBrowserPath(path))

      .catch(() => {});

  }, []);



  useEffect(() => {

    if (!isTauri || !appBrowserPath) return;

    void writeAppBrowserPath(appBrowserPath);

  }, [appBrowserPath]);



  useEffect(() => {

    if (!isTauri) return;

    localDataDir()

      .then((baseDir) => {

        const next: Record<string, string> = {};

        next["ftp-browser"] = `${baseDir}\\EnderFall\\Ender Transfer`;

        next["character-creation-sheet"] = `${baseDir}\\EnderFall\\Character Creation`;

        setDefaultInstallDirs(next);

      })

      .catch(() => {});

  }, []);

  useEffect(() => {

    if (!isTauri) return;

    void refreshInstallStatus();

  }, [defaultInstallDirs]);





  useEffect(() => {

    if (!isTauri) return;

    const migrateDefaults = async () => {

      const baseDir = await localDataDir();

      const baseLower = baseDir.toLowerCase();

      apps.forEach((app) => {

        if (installStatus[app.id]) return;

        const stored = getStoredInstallDir(app.id);

        const nextDefault = defaultInstallDirs[app.id];

        if (!nextDefault) return;

        if (!stored) {

          setStoredInstallDir(app.id, nextDefault);

          return;

        }

        const storedLower = stored.toLowerCase();

        const isLocalData = storedLower.startsWith(baseLower);

        const isProgramFiles =

          storedLower.includes("\\program files\\") || storedLower.includes("\\program files (x86)\\");

        if (isLocalData || isProgramFiles) {

          setStoredInstallDir(app.id, nextDefault);

        }

      });

    };

    void migrateDefaults();

  }, [defaultInstallDirs, installStatus]);



  useEffect(() => {

    Object.values(releaseInfoByApp).forEach((entry) => {

      if (installStatus[entry.id] && entry.version && !getStoredInstallVersion(entry.id)) {

        setStoredInstallVersion(entry.id, entry.version);

      }

    });

  }, [releaseInfoByApp, installStatus]);



  useEffect(() => {

    setEntitlementsLoaded(false);

    if (!user) {

      setEntitlements([]);
      setEntitlementsError(null);
      setEntitlementsLoaded(true);
      setCachedAdmin(null);

      return;

    }



    let active = true;

    const resolveAdminFlag = async () => {
      if (profile?.is_admin !== undefined && profile?.is_admin !== null) {
        return profile.is_admin;
      }
      const override = isTauri ? getOverrideTokens() : null;
      const accessToken = override?.access_token;
      if (isTauri && accessToken && supabaseUrl && supabaseAnonKey) {
        const fetchAdmin = async (
          table: "web_profiles" | "profiles",
          column: "id" | "user_id"
        ) => {
          const url = `${supabaseUrl}/rest/v1/${table}?select=is_admin&${column}=eq.${encodeURIComponent(
            user.id
          )}&limit=1`;
          const response = await tauriFetch<{ is_admin?: boolean | null }[]>(url, {
            method: "GET",
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          });
          if (response.status >= 400) return null;
          return response.data?.[0]?.is_admin ?? null;
        };
        try {
          const webAdmin =
            (await fetchAdmin("web_profiles", "id")) ??
            (await fetchAdmin("web_profiles", "user_id"));
          if (webAdmin !== null && webAdmin !== undefined) return webAdmin;
          const profileAdmin =
            (await fetchAdmin("profiles", "id")) ??
            (await fetchAdmin("profiles", "user_id"));
          if (profileAdmin !== null && profileAdmin !== undefined) return profileAdmin;
        } catch {
          // ignore fetch failures
        }
      }
      if (!supabase) return cachedAdmin ?? false;
      try {
        const { data } = await supabase
          .from("web_profiles")
          .select("is_admin")
          .eq("id", user.id)
          .maybeSingle();
        if (data?.is_admin !== undefined && data?.is_admin !== null) {
          return data.is_admin;
        }
      } catch {
        // ignore missing row
      }
      try {
        const { data } = await supabase
          .from("web_profiles")
          .select("is_admin")
          .eq("user_id", user.id)
          .maybeSingle();
        if (data?.is_admin !== undefined && data?.is_admin !== null) {
          return data.is_admin;
        }
      } catch {
        // ignore missing row
      }
      try {
        const { data } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", user.id)
          .maybeSingle();
        if (data?.is_admin !== undefined && data?.is_admin !== null) {
          return data.is_admin;
        }
      } catch {
        // ignore missing row
      }
      try {
        const { data } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("user_id", user.id)
          .maybeSingle();
        if (data?.is_admin !== undefined && data?.is_admin !== null) {
          return data.is_admin;
        }
      } catch {
        // ignore missing row
      }
      return cachedAdmin ?? false;
    };



    const load = async () => {
      const cached = readEntitlementsCache(user.id);
      if (cached && cached.entitlements.length > 0) {
        setEntitlements(cached.entitlements);
        setCachedAdmin(cached.isAdmin);
        setEntitlementsLoaded(true);
        setEntitlementsError(null);
      }

      if (!supabase) {

        setEntitlements([]);
        setEntitlementsError("Supabase client not configured.");
        setEntitlementsLoaded(true);

        return;

      }



      const tokens = isTauri ? getOverrideTokens() : null;
      const accessToken = tokens?.access_token;

      if (isTauri && accessToken && supabaseUrl && supabaseAnonKey) {
        try {
          const entitlementsUrl = `${supabaseUrl}/rest/v1/entitlements?select=app_id,tier,active&user_id=eq.${encodeURIComponent(
            user.id
          )}&active=eq.true`;
          const entitlementsResponse = await tauriFetch<Entitlement[]>(entitlementsUrl, {
            method: "GET",
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
          });
          if (entitlementsResponse.status < 400) {
            const adminFlag = await resolveAdminFlag();
            const entitlementsData = entitlementsResponse.data ?? [];
            setEntitlements(entitlementsData);
            setCachedAdmin(adminFlag ?? null);
            writeEntitlementsCache(user.id, entitlementsData, !!adminFlag);
            setEntitlementsError(null);
            setEntitlementsLoaded(true);
            return;
          }
        } catch {
          // fall through to supabase-js fetch
        }
      }

      if (isTauri && accessToken && tokens?.refresh_token) {

        try {

          await supabase.auth.setSession({

            access_token: accessToken,

            refresh_token: tokens.refresh_token,

          });

        } catch {

          // ignore session sync failures

        }

      }



      const isAdminFlag = await resolveAdminFlag();
      const { data, error } = await supabase

        .from("entitlements")

        .select("app_id, tier, active")

        .eq("user_id", user.id)

        .eq("active", true);

      if (!active) return;

      if (error) {

        console.warn("Failed to load entitlements.", error.message);

        setCachedAdmin(isAdminFlag);
        if (!cached?.entitlements?.length) {
          setEntitlements([]);
        }
        setEntitlementsError(error.message);
        setEntitlementsLoaded(true);

        return;

      }

      setEntitlements(data ?? []);
      setCachedAdmin(isAdminFlag ?? null);
      writeEntitlementsCache(user.id, data ?? [], !!isAdminFlag);
      setEntitlementsError(null);
      setEntitlementsLoaded(true);

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

        if (tokenSnapshot && tokenSnapshot.expiresAt > Date.now()) {
          return;
        }
        await clearLaunchToken("enderfall-hub");

        return;

      }

      const tokenAccess = !!tokenSnapshot && tokenSnapshot.expiresAt > Date.now();
      if ((!entitlementsLoaded || entitlementsError) && !tokenAccess) return;

      const allowedApps =
        entitlementsLoaded && !entitlementsError
          ? entitlements.map((entry) => entry.app_id)
          : tokenSnapshot?.entitlements ?? [];

      const displayName =

        profile?.display_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";

      const rawAvatarUrl =

        profile?.avatar_url || (user?.user_metadata?.avatar_url as string | undefined) || null;

      const avatarUrl = rawAvatarUrl;
      const avatarPath = await cacheAvatar(rawAvatarUrl, user.id);

      const isAdmin = profile?.is_admin ?? cachedAdmin ?? tokenSnapshot?.isAdmin ?? false;
      const expiresAt = Date.now() + 5 * 60 * 1000;

      await writeProfileCache({
        userId: user.id,
        displayName,
        avatarUrl,
        avatarPath,
        email: user.email ?? null,
        updatedAt: Date.now(),
      });

      await writeLaunchToken({

        appId: "enderfall-hub",

        userId: user.id,

        isAdmin,

        entitlements: allowedApps,

        expiresAt,

        appBrowserPath,

        displayName,

        avatarUrl,
        avatarPath,

        email: user.email ?? null,

      });

    };

    syncTokens();

    if (!user) return;

    const interval = window.setInterval(() => {

      syncTokens();

    }, 5 * 60 * 1000);

    return () => window.clearInterval(interval);

  }, [
    user,
    entitlements,
    entitlementsLoaded,
    entitlementsError,
    profile?.is_admin,
    cachedAdmin,
    appBrowserPath,
    tokenSnapshot,
  ]);



  const downloadUpdate = async (app: AppInfo, update: ReleaseInfo) => {

    if (!isTauri || !update.installerUrl) return;

    const installDir = getResolvedInstallBaseDir(app, defaultInstallDirs[app.id]);

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

      const installerType = update.installerType ?? "exe";

      if (installerType === "exe") {
        const args = buildInstallerArgs(app, installDir);
        await invoke("run_installer", { path: installerPath, args });
      } else {
        await invoke("install_msi_payload", {

          appId: app.id,

          installerPath,

          installDir,

          exeName: app.exeName,

          appName: app.name,

          createDesktopShortcut: false,

          createStartMenuShortcut: false,

        });
      }

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



  const updateAppBrowser = async (update: ReleaseInfo) => {

    if (!isTauri || !update.installerUrl) return;

    if (!appBrowserPath) {

      setReleaseError("App Browser path not available.");

      return;

    }

    const exeName = getFileName(appBrowserPath);

    if (!exeName) {

      setReleaseError("App Browser executable name not available.");

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

      const installerType = update.installerType ?? "msi";

      if (installerType === "exe") {
        const args = buildDefaultInstallerArgs(updateDir);
        await invoke("run_installer", { path: installerPath, args });
      } else {
        await invoke("install_msi_payload", {

          appId: update.id,

          installerPath,

          installDir: updateDir,

          exeName,

          appName: "Enderfall Hub",

          createDesktopShortcut: false,

          createStartMenuShortcut: false,

        });
      }

      setInstallMessage((prev) => ({ ...prev, [update.id]: "Update ready. Restart to use it." }));

      setStoredInstallVersion(update.id, update.version);

      await invoke("launch_path", { path: `${updateDir}\\${exeName}` });

    } catch (error) {

      const message = error instanceof Error ? error.message : String(error);

      setReleaseError(message);

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

        const installPath = getResolvedInstallExePath(app, defaultInstallDirs[app.id]);

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

  const openPreferences = () => {
    setPreferencesOpen(true);
    setMenuOpen(null);
  };



  const displayName =

    profile?.display_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Account";

  const rawAvatarUrl =

    profile?.avatar_url || (user?.user_metadata?.avatar_url as string | undefined) || null;

  const avatarUrl = rawAvatarUrl;



  const openAccount = () => {

    const url = "https://enderfall.co.uk/profile";

    if (isTauri) {

      openShell(url);

    } else {

      window.open(url, "_blank", "noopener");

    }

  };



  const openReleaseNotes = async (entry: ReleaseInfo | null, appName: string) => {

    setReleaseNotesTitle(`${appName} release notes`);

    if (!entry) {

      setReleaseNotesBody("Release notes are not available yet.");

      setReleaseNotesOpen(true);

      return;

    }

    setReleaseNotesBody(entry.notes ?? "Release notes are empty.");

    setReleaseNotesOpen(true);

  };



  const launchInstalledApp = async (app: AppInfo) => {

    if (!isTauri) return;

    const installPath = getResolvedInstallExePath(app, defaultInstallDirs[app.id]);

    if (!installPath) return;

    await invoke("launch_path", { path: installPath });

  };



  const refreshInstallStatus = async () => {

    if (!isTauri) return;

    const next: Record<string, boolean> = {};

    const devNext: Record<string, boolean> = {};

    for (const app of apps) {

      const installPath = getResolvedInstallExePath(app, defaultInstallDirs[app.id]);

      if (!installPath) {

        next[app.id] = false;

      } else {

        try {

          const exists = await invoke<boolean>("path_exists", { path: installPath });

          next[app.id] = exists;

        } catch {

          next[app.id] = false;

        }

      }

      if (app.devWorkspaceDir && app.devCommand) {

        try {

          devNext[app.id] = await invoke<boolean>("path_exists", { path: app.devWorkspaceDir });

        } catch {

          devNext[app.id] = false;

        }

      } else {

        devNext[app.id] = false;

      }

    }

    setInstallStatus(next);

    setDevStatus(devNext);

  };



  const uninstallApp = async (app: AppInfo) => {

    if (!isTauri) return;

    const installDir = getResolvedInstallBaseDir(app, defaultInstallDirs[app.id]);

    if (!installDir) return;

    setInstalling((prev) => ({ ...prev, [app.id]: true }));

    setInstallMessage((prev) => ({ ...prev, [app.id]: "Uninstalling..." }));

    try {

      await invoke("uninstall_app", { installDir, appName: app.name });

      localStorage.removeItem(`appbrowser-install-version-${app.id}`);

      localStorage.removeItem(`appbrowser-install-dir-${app.id}`);

      setInstallMessage((prev) => ({ ...prev, [app.id]: "Uninstalled." }));

      await refreshInstallStatus();

    } catch (error) {

      const message = error instanceof Error ? error.message : String(error);

      setInstallMessage((prev) => ({ ...prev, [app.id]: message }));

    } finally {

      setInstalling((prev) => ({ ...prev, [app.id]: false }));

    }

  };



  const startInstall = async (
    app: AppInfo,
    options: {
      installDir: string | null;
      createDesktopShortcut: boolean;
      createStartMenuShortcut: boolean;
    }
  ) => {
    if (!isTauri) return;
    const releaseInfo = releaseInfoByApp[app.id];
    if (!releaseInfo?.installerUrl) {
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Installer not available yet." }));
      return;
    }
    const installDir =

      options.installDir ?? getResolvedInstallBaseDir(app, defaultInstallDirs[app.id]);

    if (!installDir || !app.exeName) {

      setInstallMessage((prev) => ({ ...prev, [app.id]: "Missing install location." }));

      return;

    }

    setStoredInstallDir(app.id, installDir);

    setInstalling((prev) => ({ ...prev, [app.id]: true }));

    setInstallProgress((prev) => ({ ...prev, [app.id]: 0 }));

    setInstallMessage((prev) => ({ ...prev, [app.id]: "Downloading installer..." }));

    try {

      const baseDir = await appDataDir();
      const installersDir = await join(baseDir, "Enderfall", "Installers");
      const installerPath = await invoke<string>("download_installer", {
        appId: app.id,
        url: releaseInfo.installerUrl,
        destinationDir: installersDir,
      });
      setInstallMessage((prev) => ({ ...prev, [app.id]: "Installing..." }));

      const installerType = releaseInfo.installerType ?? "msi";

      if (installerType === "exe") {
        const args = buildInstallerArgs(app, installDir);
        await invoke("run_installer", { path: installerPath, args });
        const exePath = getResolvedInstallExePath(app, installDir);
        if (exePath) {
          await invoke("create_shortcuts", {
            exePath,
            appName: app.name,
            createDesktopShortcut: options.createDesktopShortcut,
            createStartMenuShortcut: options.createStartMenuShortcut,
          });
        }
      } else {
        await invoke("install_msi_payload", {

          appId: app.id,

          installerPath,

          installDir,

          exeName: app.exeName,

          appName: app.name,

          createDesktopShortcut: options.createDesktopShortcut,

          createStartMenuShortcut: options.createStartMenuShortcut,

        });
      }

      if (releaseInfo.version) {
        setStoredInstallVersion(app.id, releaseInfo.version);
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

        const showDevActions = import.meta.env.DEV && isTauri;

        const tokenAccess = !!tokenSnapshot && tokenSnapshot.expiresAt > Date.now();
        const tokenIsAdmin = tokenAccess ? tokenSnapshot?.isAdmin ?? false : false;
        const tokenEntitled =
          tokenAccess &&
          (tokenIsAdmin ||
            tokenSnapshot?.entitlements.includes(app.id) ||
            tokenSnapshot?.entitlements.includes("all-apps"));
        const isAdmin =

          profile?.is_admin ??

          ((user?.user_metadata as Record<string, unknown> | undefined)?.is_admin as boolean | undefined) ??

          ((user?.app_metadata as Record<string, unknown> | undefined)?.is_admin as boolean | undefined) ??

          cachedAdmin ??

          tokenIsAdmin ??

          false;

        const entitledFromSupabase = !!user && (isAdmin || hasAccess(entitlements, app.id));
        const entitled = entitledFromSupabase || !!tokenEntitled;

        const premiumLocked = app.supportsPremium && !entitled;

        const isInstalled = installStatus[app.id] ?? false;

        const releaseInfo = releaseInfoByApp[app.id];
        const canInstall = Boolean(releaseInfo?.installerUrl);
        const installPath = getResolvedInstallExePath(app, defaultInstallDirs[app.id]);

        const devAvailable = showDevActions && (devStatus[app.id] ?? Boolean(app.devWorkspaceDir));
        const installedVersion = getStoredInstallVersion(app.id);

        const updateAvailable =
          !!installedVersion &&
          !!releaseInfo?.version &&
          !!releaseInfo?.installerUrl &&
          compareVersions(releaseInfo.version, installedVersion) > 0;
        return {
          app,
          entitled,
          premiumLocked,
          isInstalled,
          canInstall,
          installPath,
          devAvailable,
          progress: installProgress[app.id] ?? 0,
          isInstalling: installing[app.id] ?? false,
          message: installMessage[app.id],
          installedVersion,
          updateInfo: releaseInfo,
          updateAvailable,
        };
      }),
    [

      entitlements,

      installStatus,

      installProgress,

      installing,

      installMessage,

      defaultInstallDirs,

      devStatus,

      user,

      profile,

      cachedAdmin,

      tokenSnapshot,

      releaseInfoByApp,
    ]

  );



  const isDevHost = appBrowserPath?.toLowerCase().includes("\\src-tauri\\target\\debug\\") ?? false;



  const launchDevApp = async (app: AppInfo) => {

    if (!isTauri || !app.devWorkspaceDir || !app.devCommand) return;

    await invoke("run_dev_app", { cwd: app.devWorkspaceDir, command: app.devCommand });

  };



  const updateCount = appCards.filter((entry) => entry.updateAvailable).length;



  const activeDownloads = appCards

    .filter((entry) => entry.isInstalling || entry.progress > 0 || updating[entry.app.id])

    .map((entry) => ({

      id: entry.app.id,

      name: entry.app.name,

      progress: entry.progress,

      message: entry.message,

    }));



  const pendingUpdates = appCards

    .filter((entry) => entry.updateAvailable)

    .map((entry) => ({ id: entry.app.id, name: entry.app.name }));

  const overrideTokens = isTauri ? getOverrideTokens() : null;
  const authStatusLines = [
    `Auth: tauri=${isTauri ? "yes" : "no"}, override=${overrideTokens ? "yes" : "no"}, token=${
      tokenSnapshot ? "yes" : "no"
    }`,
    `Entitlements: ${entitlements.length}, loaded=${entitlementsLoaded ? "yes" : "no"}, error=${
      entitlementsError ? "yes" : "no"
    }`,
    `Admin: profile=${profile?.is_admin ?? "null"}, cached=${cachedAdmin ?? "null"}, token=${
      tokenSnapshot?.isAdmin ?? "null"
    }`,
  ];



  return (

    <div className="page">

      <div className="stars" />



      <MainHeader

        logoSrc="/brand/enderfall-mark.png"

        menus={[

          {

            id: "file",

            label: "File",

            content: (

              <>

                <button className="ef-menu-item" type="button" onClick={() => window.location.reload()}>

                  Refresh apps

                </button>

                <div className="ef-menu-divider" />

                <button className="ef-menu-item" type="button" onClick={() => setShowLogin(true)}>

                  Open login

                </button>

                <button className="ef-menu-item" type="button" onClick={openPreferences}>

                  Preferences

                </button>

              </>

            ),

          },

          {

            id: "edit",

            label: "Edit",

            content: (

              <button

                className="ef-menu-item"

                type="button"

                onClick={() => navigator.clipboard?.writeText(window.location.href)}

              >

                Copy hub link

              </button>

            ),

          },

          {

            id: "view",

            label: "View",

            content: (

              <div className="ef-menu-item has-submenu" role="button" tabIndex={0}>

                <span>Theme</span>

                <span className="ef-menu-sub-caret">

                  <IconChevronDown />

                </span>

                <div className="ef-menu-sub">

                  {themeOptions.map((item) => (

                    <button

                      key={item.value}

                      className="ef-menu-item"

                      type="button"

                      onClick={() => setThemeMode(item.value)}

                    >

                      {item.label}

                    </button>

                  ))}

                </div>

              </div>

            ),

          },

          {

            id: "help",

            label: "Help",

            content: (

              <button

                className="ef-menu-item"

                type="button"

                onClick={() => window.open("https://enderfall.co.uk", "_blank")}

              >

                About Enderfall

              </button>

            ),

          },

        ]}

        menuOpen={menuOpen}

        onOpenMenu={openMenu}

        onCloseMenu={closeMenu}

        actions={

          <div className="actions">

            <button

              className="icon-action"

              type="button"

              title="Downloads"

              onClick={() => setShowDownloads(true)}

              disabled={!isTauri}

            >

              <FaDownload />

              {updateCount > 0 ? <span className="icon-badge">{updateCount}</span> : null}

            </button>

            {!isLoading && user ? (

              <Dropdown

                variant="user"

                name={displayName}

                avatarUrl={avatarUrl}

                avatarFallback={displayName.slice(0, 1).toUpperCase()}

                items={[

                  {

                    label: "Profile",

                    onClick: openAccount,

                  },


                  {

                    label: "Logout",

                    onClick: () => signOut(),

                  },

                ]}

              />

            ) : (

              <button className="primary" onClick={() => setShowLogin(true)}>

                Login

              </button>

            )}

          </div>

        }

      />



      <section className="hero">

        <div className="hero-top">

          <div className="hero-copy">

            <p className="kicker">Enderfall App Hub</p>

            <h1>Launch your galaxy toolkit in one place.</h1>

            <p className="subhead">

              Install and launch your desktop apps from a single home base.

            </p>

          </div>

        </div>

        <div className="hero-highlights">

          <Panel variant="highlight" borderWidth={1} className="hero-highlight">

            <span className="highlight-label">Premium builds</span>

            <span className="highlight-value">Desktop installs</span>

          </Panel>

          <Panel variant="highlight" borderWidth={1} className="hero-highlight">

            <span className="highlight-label">Themes</span>

            <span className="highlight-value">Galaxy + System</span>

          </Panel>

          <Panel variant="highlight" borderWidth={1} className="hero-highlight">

            <span className="highlight-label">Library</span>

            <span className="highlight-value">Unified launch</span>

          </Panel>

        </div>

      </section>



      {!isTauri ? (

        <div className="card-note">

          Desktop features require the Tauri build. Installers and launch actions are disabled in the browser.

        </div>

      ) : null}



      {releaseError ? <div className="card-note">Failed to load updates: {releaseError}</div> : null}


      <section className="grid">

        {appCards.map(({ app, entitled, premiumLocked, isInstalled, canInstall, installPath, devAvailable, progress, isInstalling, message, updateAvailable, updateInfo }) => {

          const cardStyle = app.cardGradient

            ? ({ "--ef-stacked-image-gradient": app.cardGradient } as CSSProperties)

            : undefined;

          return (

          <StackedCard

            key={app.id}

            variant="apps"

            align="left"

            showImage={true}

            frameClassName="app-card-frame"

            cardClassName="app-card"

            bodyClassName="app-card-body"

            style={cardStyle}

          >

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

                <>

                  <button

                    className="primary"

                    onClick={() => launchInstalledApp(app)}

                    disabled={!isTauri || premiumLocked}

                  >

                    Open app

                  </button>

                  <Button

                    variant="delete"

                    onClick={() => uninstallApp(app)}

                    disabled={!isTauri || isInstalling}

                  >

                    <span className="button-icon">

                      <FaTrashAlt />

                    </span>

                    Uninstall

                  </Button>

                </>

              ) : (

                <button

                  className="ghost"

                  onClick={() => setInstallModalAppId(app.id)}

                  disabled={!isTauri || premiumLocked || !canInstall || isInstalling}

                >

                  Install

                </button>

              )}

              {devAvailable ? (

                <button className="ghost" type="button" onClick={() => launchDevApp(app)}>

                  Open local (dev)

                </button>

              ) : null}

              {updateAvailable && updateInfo ? (

                <Button

                  variant="warning"

                  type="button"

                  onClick={() =>

                    app.id === "app-browser" ? updateAppBrowser(updateInfo) : downloadUpdate(app, updateInfo)

                  }

                  disabled={!isTauri || updating[app.id]}

                >

                  {updating[app.id] ? "Updating..." : "Update"}

                </Button>

              ) : null}

              <Button

                variant="info"

                type="button"

                onClick={() => openReleaseNotes(updateInfo ?? null, app.name)}

              >

                Release notes

              </Button>

              <button

                className={`icon-action small ${isRefreshing ? "spin" : ""}`}

                type="button"

                title="Refresh"

                onClick={refreshAll}

                disabled={isRefreshing}

              >

                <FaSyncAlt />

              </button>

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

            {!canInstall ? <div className="card-note">Installer not available yet.</div> : null}

            {premiumLocked ? (

              <div className="card-note">Premium access required for desktop installs.</div>

            ) : null}

          </StackedCard>

        )})}

      </section>



      <Panel variant="highlight" borderWidth={2} className="footer-band">

        <div>

          <h2>Need a custom tool?</h2>

          <p>We build bespoke tooling for studios, creators, and game communities.</p>

        </div>

        <button className="cta-primary" onClick={() => window.open("https://enderfall.co.uk/contact", "_blank")}>

          Contact the team

        </button>

      </Panel>



      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />

      <PreferencesModal
        isOpen={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        themeMode={themeMode}
        onThemeChange={(value) => setThemeMode(value as ThemeMode)}
        themeOptions={themeOptions}
        animationsEnabled={animationsEnabled}
        onAnimationsChange={setAnimationsEnabled}
      >
        <div className="prefs-section">
          <div className="prefs-section-title">Enderfall Hub</div>
          <Toggle
            variant="checkbox"
            checked={hubPreferences.openOnStartup}
            onChange={(event) =>
              void updateHubPreferences({ openOnStartup: event.target.checked })
            }
            label="Open on startup"
          />
          <Toggle
            variant="checkbox"
            checked={hubPreferences.closeToTray}
            onChange={(event) =>
              void updateHubPreferences({ closeToTray: event.target.checked })
            }
            label="Close to tray"
          />
          <Toggle
            variant="checkbox"
            checked={hubPreferences.minimizeToTray}
            onChange={(event) =>
              void updateHubPreferences({ minimizeToTray: event.target.checked })
            }
            label="Minimize to tray"
          />
        </div>
      </PreferencesModal>

      <DownloadsModal

        isOpen={showDownloads}

        items={activeDownloads}

        updates={pendingUpdates}

        onClose={() => setShowDownloads(false)}

        onUpdate={(id) => {

          const entry = appCards.find((item) => item.app.id === id);

          if (!entry?.updateInfo) return;

          if (id === "app-browser") {

            void updateAppBrowser(entry.updateInfo);

          } else {

            void downloadUpdate(entry.app, entry.updateInfo);

          }

        }}

      />

      <ReleaseNotesModal

        isOpen={releaseNotesOpen}

        title={releaseNotesTitle}

        notes={releaseNotesBody}

        onClose={() => setReleaseNotesOpen(false)}

      />

      <InstallModal
        app={installModalAppId ? apps.find((item) => item.id === installModalAppId) ?? null : null}
        isOpen={!!installModalAppId}
        onClose={() => setInstallModalAppId(null)}
        defaultInstallDir={installModalAppId ? defaultInstallDirs[installModalAppId] : undefined}
        prereleaseEnabled={installModalAppId ? prereleasePrefs[installModalAppId] ?? false : false}
        onPrereleaseChange={(value) => {
          if (!installModalAppId) return;
          setPrereleasePreference(installModalAppId, value);
        }}
        releaseInfo={installModalAppId ? releaseInfoByApp[installModalAppId] : undefined}
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







































