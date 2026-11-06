"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  FolderKanban,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

const ZOHO_DCS = [
  { value: "com", label: "US / Global (.com)" },
  { value: "eu", label: "Europe (.eu)" },
  { value: "in", label: "India (.in)" },
  { value: "com.au", label: "Australia (.com.au)" },
  { value: "jp", label: "Japan (.jp)" },
  { value: "ca", label: "Canada (.ca)" },
  { value: "uk", label: "United Kingdom (.uk)" },
];

const EMPTY_FORM = {
  profileName: "",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  projectId: "",
  fromEmail: "",
  dc: "com",
};

export default function ProfileModal({
  open,
  onClose,
  profiles,
  initialProfile,
  onSaveProfile,
  onDeleteProfile,
  showToast,
}) {
  const [editingOriginalName, setEditingOriginalName] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedUri, setCopiedUri] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [testStatus, setTestStatus] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [originUrl, setOriginUrl] = useState("");

  // Project & Sender Discovery State
  const [fetchingProjects, setFetchingProjects] = useState(false);
  const [fetchedProjects, setFetchedProjects] = useState([]);
  const [projectsPickerOpen, setProjectsPickerOpen] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState("");

  const [fetchingSenders, setFetchingSenders] = useState(false);
  const [fetchedSenders, setFetchedSenders] = useState([]);
  const [sendersPickerOpen, setSendersPickerOpen] = useState(false);

  const cleanupOauthRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const resetDiscoveryLists = () => {
    setFetchedProjects([]);
    setProjectsPickerOpen(false);
    setSelectedOrgId("");
    setFetchedSenders([]);
    setSendersPickerOpen(false);
  };

  useEffect(() => {
    if (!open) {
      if (cleanupOauthRef.current) {
        cleanupOauthRef.current();
        cleanupOauthRef.current = null;
      }
      setOauthWaiting(false);
      setTestStatus(null);
      setConfirmDelete(false);
      resetDiscoveryLists();
      return;
    }

    if (initialProfile) {
      setEditingOriginalName(initialProfile.profileName);
      setForm({
        profileName: initialProfile.profileName || "",
        clientId: initialProfile.clientId || "",
        clientSecret: initialProfile.clientSecret || "",
        refreshToken: initialProfile.refreshToken || "",
        projectId: initialProfile.projectId || "",
        fromEmail: initialProfile.fromEmail || "",
        dc: initialProfile.dc || "com",
      });
    } else {
      setEditingOriginalName(null);
      setForm(EMPTY_FORM);
    }
    setTestStatus(null);
    setConfirmDelete(false);
    resetDiscoveryLists();
  }, [open, initialProfile]);

  if (!open) return null;

  const redirectUri = originUrl
    ? `${originUrl}/api/zoho/callback`
    : "/api/zoho/callback";

  const selectProfileToEdit = (p) => {
    setEditingOriginalName(p.profileName);
    setForm({
      profileName: p.profileName || "",
      clientId: p.clientId || "",
      clientSecret: p.clientSecret || "",
      refreshToken: p.refreshToken || "",
      projectId: p.projectId || "",
      fromEmail: p.fromEmail || "",
      dc: p.dc || "com",
    });
    setTestStatus(null);
    setConfirmDelete(false);
    resetDiscoveryLists();
  };

  const startNewProfile = () => {
    setEditingOriginalName(null);
    setForm(EMPTY_FORM);
    setTestStatus(null);
    setConfirmDelete(false);
    resetDiscoveryLists();
  };

  const copyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleGenerateToken = async () => {
    const clientId = form.clientId.trim();
    const clientSecret = form.clientSecret.trim();

    if (!clientId || !clientSecret) {
      showToast(
        "Missing Credentials",
        "Enter both Client ID and Client Secret before generating a Refresh Token.",
        "error"
      );
      return;
    }

    if (cleanupOauthRef.current) {
      cleanupOauthRef.current();
      cleanupOauthRef.current = null;
    }

    setOauthWaiting(true);
    setTestStatus(null);

    const popup = window.open(
      "about:blank",
      "ZohoOAuthConsent",
      "width=580,height=720,menubar=no,toolbar=no,status=no"
    );

    try {
      const res = await fetch("/api/zoho/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          clientId,
          clientSecret,
          dc: form.dc || "com",
          origin: window.location.origin,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.authUrl || !data.state) {
        if (popup && !popup.closed) popup.close();
        setOauthWaiting(false);
        showToast(
          "OAuth Initialization Failed",
          data.error || "Could not create Zoho OAuth URL.",
          "error"
        );
        return;
      }

      if (popup) {
        popup.location.href = data.authUrl;
      } else {
        window.open(data.authUrl, "_blank");
      }

      const expectedState = data.state;
      const storageKey = `zc_oauth_result_${expectedState}`;
      let resolved = false;

      const handleOAuthPayload = (payload) => {
        if (resolved || !payload || payload.state !== expectedState) return;
        resolved = true;
        if (cleanupOauthRef.current) {
          cleanupOauthRef.current();
          cleanupOauthRef.current = null;
        }
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
        setOauthWaiting(false);

        if (payload.success && payload.refreshToken) {
          setForm((prev) => ({
            ...prev,
            refreshToken: payload.refreshToken,
            dc: payload.detectedDc || prev.dc,
          }));
          showToast(
            "Refresh Token Captured",
            "Zoho authorization succeeded. You can now Fetch Projects & Senders or Save Profile.",
            "success"
          );
        } else {
          showToast(
            "Zoho OAuth Error",
            payload.error || "Authorization did not return a refresh token.",
            "error"
          );
        }
      };

      const onWindowMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "ZOHO_OAUTH_RESULT") {
          handleOAuthPayload(event.data);
        }
      };

      window.addEventListener("message", onWindowMessage);

      let bc = null;
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("zc_oauth_channel");
        bc.onmessage = (ev) => {
          if (ev.data?.type === "ZOHO_OAUTH_RESULT") {
            handleOAuthPayload(ev.data);
          }
        };
      }

      let closedTicks = 0;
      const pollTimer = setInterval(() => {
        try {
          const raw = localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            handleOAuthPayload(parsed);
            return;
          }
        } catch {
          // ignore
        }

        if (popup && popup.closed) {
          closedTicks += 1;
          if (closedTicks >= 2 && !resolved) {
            resolved = true;
            if (cleanupOauthRef.current) {
              cleanupOauthRef.current();
              cleanupOauthRef.current = null;
            }
            setOauthWaiting(false);
          }
        }
      }, 500);

      cleanupOauthRef.current = () => {
        window.removeEventListener("message", onWindowMessage);
        if (bc) bc.close();
        clearInterval(pollTimer);
      };
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      setOauthWaiting(false);
      showToast("Network Error", err.message, "error");
    }
  };

  const handleFetchProjects = async () => {
    const clientId = form.clientId.trim();
    const clientSecret = form.clientSecret.trim();
    const refreshToken = form.refreshToken.trim();

    if (!clientId || !clientSecret || !refreshToken) {
      showToast(
        "Credentials Required",
        "Enter Client ID, Client Secret, and Refresh Token first before fetching projects.",
        "error"
      );
      return;
    }

    setFetchingProjects(true);
    setTestStatus(null);

    try {
      const res = await fetch("/api/catalyst/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            clientId,
            clientSecret,
            refreshToken,
            dc: form.dc || "com",
          },
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setTestStatus({
          ok: false,
          text: data.error || "Failed to fetch Catalyst projects.",
        });
        showToast(
          "Project Fetch Failed",
          data.error || "Could not retrieve projects from Zoho Catalyst.",
          "error"
        );
        return;
      }

      const list = Array.isArray(data.projects) ? data.projects : [];
      setFetchedProjects(list);

      if (list.length === 0) {
        setProjectsPickerOpen(false);
        showToast(
          "No Projects Found",
          "No Catalyst projects were returned for this Zoho account/DC.",
          "warning"
        );
        return;
      }

      if (list.length === 1) {
        const only = list[0];
        setForm((prev) => ({ ...prev, projectId: only.id }));
        setSelectedOrgId(only.orgId || "");
        setProjectsPickerOpen(true);
        setFetchedSenders([]);
        setSendersPickerOpen(false);
        showToast(
          "Project Auto-Selected",
          `Selected "${only.name}" (${only.id}).`,
          "success"
        );
      } else {
        setProjectsPickerOpen(true);
        showToast(
          "Projects Loaded",
          `Found ${list.length} Catalyst projects. Select one below.`,
          "success"
        );
      }
    } catch (err) {
      showToast("Network Error", err.message, "error");
    } finally {
      setFetchingProjects(false);
    }
  };

  const handleSelectProject = (proj) => {
    setForm((prev) => ({ ...prev, projectId: proj.id }));
    setSelectedOrgId(proj.orgId || "");
    setProjectsPickerOpen(false);
    setFetchedSenders([]);
    setSendersPickerOpen(false);
  };

  const handleFetchSenders = async () => {
    const clientId = form.clientId.trim();
    const clientSecret = form.clientSecret.trim();
    const refreshToken = form.refreshToken.trim();
    const projectId = form.projectId.trim();

    if (!clientId || !clientSecret || !refreshToken) {
      showToast(
        "Credentials Required",
        "Enter Client ID, Client Secret, and Refresh Token first.",
        "error"
      );
      return;
    }

    if (!projectId) {
      showToast(
        "Project ID Required",
        "Fetch or enter a Catalyst Project ID first so sender addresses can be queried for that project.",
        "warning"
      );
      return;
    }

    setFetchingSenders(true);
    setTestStatus(null);

    try {
      const matchedProject = fetchedProjects.find((p) => p.id === projectId);
      const orgToUse = selectedOrgId || matchedProject?.orgId || "";

      const res = await fetch("/api/catalyst/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            clientId,
            clientSecret,
            refreshToken,
            dc: form.dc || "com",
          },
          projectId,
          orgId: orgToUse,
        }),
      });
      const data = await res.json();

      // Merge any owner email discovered earlier from Fetch Projects if valid
      const combined = Array.isArray(data.senders) ? [...data.senders] : [];
      if (
        matchedProject?.createdByEmail &&
        !combined.some(
          (s) =>
            s.email.toLowerCase() ===
            matchedProject.createdByEmail.toLowerCase()
        )
      ) {
        combined.unshift({
          email: matchedProject.createdByEmail,
          name: matchedProject.createdByName || "",
          source: "Project Owner",
          verified: true,
        });
      }

      if ((!res.ok || !data.success) && combined.length === 0) {
        setTestStatus({
          ok: false,
          text:
            data.error || "Could not fetch sender emails for this project.",
        });
        showToast(
          "Sender Fetch Failed",
          data.error || "Could not retrieve sender addresses.",
          "error"
        );
        return;
      }

      setFetchedSenders(combined);

      if (combined.length === 1) {
        setForm((prev) => ({ ...prev, fromEmail: combined[0].email }));
        setSendersPickerOpen(true);
        showToast(
          "Sender Email Populated",
          `Selected "${combined[0].email}" (${combined[0].source}).`,
          "success"
        );
      } else {
        setSendersPickerOpen(true);
        showToast(
          "Sender Addresses Loaded",
          `Found ${combined.length} project email address(es). Click one to select.`,
          "success"
        );
      }
    } catch (err) {
      showToast("Network Error", err.message, "error");
    } finally {
      setFetchingSenders(false);
    }
  };

  const handleTestConnection = async () => {
    if (
      !form.clientId.trim() ||
      !form.clientSecret.trim() ||
      !form.refreshToken.trim()
    ) {
      showToast(
        "Incomplete Credentials",
        "Client ID, Client Secret, and Refresh Token are required to test OAuth.",
        "error"
      );
      return;
    }

    setTestingConn(true);
    setTestStatus(null);
    const t0 = performance.now();

    try {
      const res = await fetch("/api/catalyst/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: {
            clientId: form.clientId.trim(),
            clientSecret: form.clientSecret.trim(),
            refreshToken: form.refreshToken.trim(),
            dc: form.dc || "com",
          },
          forceRefresh: true,
        }),
      });
      const data = await res.json();
      const ms = Math.round(performance.now() - t0);

      if (res.ok && data.success && data.accessToken) {
        setTestStatus({
          ok: true,
          text: `OAuth handshake verified (${ms}ms)`,
        });
      } else {
        setTestStatus({
          ok: false,
          text: data.error || "Failed to exchange refresh token.",
        });
      }
    } catch (err) {
      setTestStatus({ ok: false, text: err.message });
    } finally {
      setTestingConn(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleaned = {
      profileName: form.profileName.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
      refreshToken: form.refreshToken.trim(),
      projectId: form.projectId.trim(),
      fromEmail: form.fromEmail.trim(),
      dc: form.dc || "com",
    };

    if (
      !cleaned.profileName ||
      !cleaned.clientId ||
      !cleaned.clientSecret ||
      !cleaned.refreshToken
    ) {
      showToast(
        "Required Fields Missing",
        "Profile Name, Client ID, Client Secret, and Refresh Token are required.",
        "error"
      );
      return;
    }

    onSaveProfile(cleaned, editingOriginalName);
  };

  const handleDelete = () => {
    if (!editingOriginalName) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDeleteProfile(editingOriginalName);
  };

  const activeMatchedProject = fetchedProjects.find(
    (p) => p.id === form.projectId.trim()
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 dark:bg-black/80 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="panel-surface w-full max-w-2xl rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800/90 bg-zinc-50 dark:bg-zinc-950/70">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
              {editingOriginalName
                ? `Configure Profile — ${editingOriginalName}`
                : "New Zoho Catalyst Profile"}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Stored locally in browser storage • Stateless server-side OAuth execution
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/70 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Saved Profiles Quick Strip */}
        <div className="px-6 py-2.5 bg-zinc-100/80 dark:bg-[#0C0C10] border-b border-zinc-200 dark:border-zinc-800/80 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={startNewProfile}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border whitespace-nowrap transition ${
              !editingOriginalName
                ? "bg-blue-600/10 dark:bg-blue-600/15 border-blue-600/35 dark:border-blue-500/40 text-blue-700 dark:text-blue-300"
                : "bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            New Profile
          </button>
          {profiles.map((p) => (
            <button
              key={p.profileName}
              type="button"
              onClick={() => selectProfileToEdit(p)}
              className={`px-2.5 py-1 rounded text-xs font-mono border whitespace-nowrap transition ${
                editingOriginalName === p.profileName
                  ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
                  : "bg-white dark:bg-zinc-950 border-zinc-300 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              {p.profileName}
            </button>
          ))}
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 max-h-[78vh] overflow-y-auto"
        >
          {/* Redirect URI Callout */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800/90">
            <div className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Authorized Redirect URI (Zoho API Console → Server-based App)
              </span>
              <code className="block text-xs font-mono text-emerald-700 dark:text-emerald-400 truncate mt-0.5 select-all">
                {redirectUri}
              </code>
            </div>
            <button
              type="button"
              onClick={copyRedirectUri}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-300 transition"
            >
              {copiedUri ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Copied
                  </span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                  <span>Copy URI</span>
                </>
              )}
            </button>
          </div>

          {/* Profile Name & Region */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                Profile Identifier <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.profileName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, profileName: e.target.value }))
                }
                placeholder="e.g. Prod_Catalyst_US"
                className="input-sharp w-full font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                Zoho Data Center
              </label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={form.dc}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, dc: e.target.value }))
                  }
                  className="input-sharp w-full pl-8 pr-3"
                >
                  {ZOHO_DCS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Client ID & Secret */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                Client ID <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={form.clientId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, clientId: e.target.value }))
                }
                placeholder="1000.XXXXXXXXXXXXXXXX"
                className="input-sharp w-full font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
                Client Secret <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={form.clientSecret}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, clientSecret: e.target.value }))
                  }
                  placeholder="••••••••••••••••••••••••"
                  className="input-sharp w-full pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  {showSecret ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Refresh Token + OAuth Generator */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Refresh Token <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.refreshToken}
                onChange={(e) =>
                  setForm((f) => ({ ...f, refreshToken: e.target.value }))
                }
                placeholder="Click Generate Token or paste 1000.xxxx..."
                className="input-sharp flex-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleGenerateToken}
                disabled={oauthWaiting}
                className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition"
              >
                {oauthWaiting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Authorizing...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Generate Token</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Project ID & From Email with Discovery Fetch Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
            {/* Catalyst Project ID */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Catalyst Project ID
                </label>
                {fetchedProjects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setProjectsPickerOpen((v) => !v)}
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {projectsPickerOpen
                      ? "Hide list"
                      : `${fetchedProjects.length} project(s)`}
                  </button>
                )}
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={form.projectId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, projectId: e.target.value }))
                  }
                  placeholder="e.g. 2100000012345"
                  className="input-sharp flex-1 min-w-0 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={handleFetchProjects}
                  disabled={fetchingProjects}
                  title="Fetch all Catalyst projects from Zoho account"
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 transition disabled:opacity-50"
                >
                  {fetchingProjects ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                  ) : (
                    <FolderKanban className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  )}
                  <span>Fetch</span>
                </button>
              </div>

              {activeMatchedProject && !projectsPickerOpen && (
                <p className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 truncate">
                  ✓ {activeMatchedProject.name}
                  {activeMatchedProject.orgName
                    ? ` (${activeMatchedProject.orgName})`
                    : ""}
                </p>
              )}

              {projectsPickerOpen && fetchedProjects.length > 0 && (
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0C0C10] overflow-hidden shadow-sm">
                  <div className="px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    <span>Select Project ({fetchedProjects.length})</span>
                    <button
                      type="button"
                      onClick={() => setProjectsPickerOpen(false)}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {fetchedProjects.map((proj) => {
                      const isSelected = form.projectId.trim() === proj.id;
                      return (
                        <button
                          key={`${proj.orgId || "default"}_${proj.id}`}
                          type="button"
                          onClick={() => handleSelectProject(proj)}
                          className={`w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 text-xs transition ${
                            isSelected
                              ? "bg-blue-600/10 dark:bg-blue-500/15 text-blue-800 dark:text-blue-200"
                              : "hover:bg-zinc-200/60 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium truncate">{proj.name}</p>
                            <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                              {proj.id}
                              {proj.orgName ? ` • ${proj.orgName}` : ""}
                            </p>
                          </div>
                          {isSelected ? (
                            <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                          ) : (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                              {proj.type || "Live"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Verified Sender Email (From Address) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Verified Sender Email (From)
                </label>
                {fetchedSenders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSendersPickerOpen((v) => !v)}
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {sendersPickerOpen
                      ? "Hide list"
                      : `${fetchedSenders.length} email(s)`}
                  </button>
                )}
              </div>

              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={form.fromEmail}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fromEmail: e.target.value }))
                  }
                  placeholder="noreply@yourdomain.com"
                  className="input-sharp flex-1 min-w-0 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={handleFetchSenders}
                  disabled={fetchingSenders}
                  title="Fetch project owner/admin sender addresses using Project ID"
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 transition disabled:opacity-50"
                >
                  {fetchingSenders ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Mail className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span>Fetch</span>
                </button>
              </div>

              {sendersPickerOpen && fetchedSenders.length > 0 && (
                <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0C0C10] overflow-hidden shadow-sm">
                  <div className="px-2.5 py-1.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    <span>Select From Email ({fetchedSenders.length})</span>
                    <button
                      type="button"
                      onClick={() => setSendersPickerOpen(false)}
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                    {fetchedSenders.map((s) => {
                      const isSelected =
                        form.fromEmail.trim().toLowerCase() ===
                        s.email.toLowerCase();
                      return (
                        <button
                          key={s.email}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({
                              ...prev,
                              fromEmail: s.email,
                            }));
                            setSendersPickerOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-2 flex items-center justify-between gap-2 text-xs transition ${
                            isSelected
                              ? "bg-emerald-600/10 dark:bg-emerald-500/15 text-emerald-900 dark:text-emerald-200"
                              : "hover:bg-zinc-200/60 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-[11px] font-medium truncate">
                              {s.email}
                            </p>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
                              {s.source}
                              {s.name ? ` • ${s.name}` : ""}
                            </p>
                          </div>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="px-2.5 py-1.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-950/80 text-[10px] text-zinc-500 leading-snug">
                    Custom domain senders added in Console → Notify → Mail can also be typed above.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Connection / Scope Diagnostic Banner */}
          {testStatus && (
            <div
              className={`px-3.5 py-2.5 rounded-md border text-xs font-mono flex items-center gap-2 ${
                testStatus.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="break-words">{testStatus.text}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-800/90">
            <div>
              {editingOriginalName && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                    confirmDelete
                      ? "bg-rose-600 text-white border-rose-500"
                      : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25 hover:bg-rose-500/20"
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {confirmDelete ? "Click to Confirm Delete" : "Delete Profile"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConn}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200/80 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 transition disabled:opacity-50"
              >
                {testingConn ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                )}
                <span>Test OAuth</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-md text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="px-4 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition"
              >
                Save Profile
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
