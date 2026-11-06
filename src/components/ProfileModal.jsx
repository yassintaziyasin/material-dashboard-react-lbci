"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Plus,
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

  const cleanupOauthRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOriginUrl(window.location.origin);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      if (cleanupOauthRef.current) {
        cleanupOauthRef.current();
        cleanupOauthRef.current = null;
      }
      setOauthWaiting(false);
      setTestStatus(null);
      setConfirmDelete(false);
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
  };

  const startNewProfile = () => {
    setEditingOriginalName(null);
    setForm(EMPTY_FORM);
    setTestStatus(null);
    setConfirmDelete(false);
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
            "Zoho authorization succeeded. Click Save Profile to persist.",
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
          // Give 2 ticks (~1s) after popup closes in case storage write is settling
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

  const handleTestConnection = async () => {
    if (!form.clientId.trim() || !form.clientSecret.trim() || !form.refreshToken.trim()) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="panel-surface w-full max-w-2xl rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/90 bg-zinc-950/70">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
              {editingOriginalName
                ? `Configure Profile — ${editingOriginalName}`
                : "New Zoho Catalyst Profile"}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Stored locally in browser storage • Stateless server-side OAuth execution
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Saved Profiles Quick Strip */}
        <div className="px-6 py-2.5 bg-[#0C0C10] border-b border-zinc-800/80 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={startNewProfile}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border whitespace-nowrap transition ${
              !editingOriginalName
                ? "bg-blue-600/15 border-blue-500/40 text-blue-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
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
                  ? "bg-zinc-800 border-zinc-600 text-zinc-100"
                  : "bg-zinc-950 border-zinc-800/80 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {p.profileName}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[78vh] overflow-y-auto">
          {/* Redirect URI Callout */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-zinc-950 border border-zinc-800/90">
            <div className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Authorized Redirect URI (Zoho API Console → Server-based App)
              </span>
              <code className="block text-xs font-mono text-emerald-400 truncate mt-0.5 select-all">
                {redirectUri}
              </code>
            </div>
            <button
              type="button"
              onClick={copyRedirectUri}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition"
            >
              {copiedUri ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Copy URI</span>
                </>
              )}
            </button>
          </div>

          {/* Profile Name & Region */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Profile Identifier <span className="text-rose-400">*</span>
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
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Zoho Data Center
              </label>
              <div className="relative">
                <Globe className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={form.dc}
                  onChange={(e) => setForm((f) => ({ ...f, dc: e.target.value }))}
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
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Client ID <span className="text-rose-400">*</span>
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
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Client Secret <span className="text-rose-400">*</span>
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
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
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
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
              Refresh Token <span className="text-rose-400">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.refreshToken}
                onChange={(e) =>
                  setForm((f) => ({ ...f, refreshToken: e.target.value }))
                }
                placeholder="Click Authorize & Generate or paste 1000.xxxx..."
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

          {/* Project ID & From Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Catalyst Project ID
              </label>
              <input
                type="text"
                value={form.projectId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, projectId: e.target.value }))
                }
                placeholder="e.g. 2100000012345"
                className="input-sharp w-full font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">
                Verified Sender Email (From Address)
              </label>
              <input
                type="email"
                value={form.fromEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, fromEmail: e.target.value }))
                }
                placeholder="noreply@yourdomain.com"
                className="input-sharp w-full font-mono text-xs"
              />
            </div>
          </div>

          {/* Connection Test Banner */}
          {testStatus && (
            <div
              className={`px-3.5 py-2.5 rounded-md border text-xs font-mono flex items-center gap-2 ${
                testStatus.ok
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-rose-500/10 border-rose-500/30 text-rose-300"
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="break-all">{testStatus.text}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-zinc-800/90">
            <div>
              {editingOriginalName && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition ${
                    confirmDelete
                      ? "bg-rose-600 text-white border-rose-500"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20"
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
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 transition disabled:opacity-50"
              >
                {testingConn ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>Test OAuth</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-md text-xs font-medium text-zinc-400 hover:text-zinc-100 transition"
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
