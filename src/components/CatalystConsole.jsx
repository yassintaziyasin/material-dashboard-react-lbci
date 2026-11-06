"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FolderKanban,
  Layers,
  Loader2,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import ProfileModal from "@/components/ProfileModal";
import HtmlPreviewModal from "@/components/HtmlPreviewModal";
import PayloadModal from "@/components/PayloadModal";

const STORAGE_PROFILES_KEY = "zc_ops_profiles_v1";
const STORAGE_ACTIVE_PROFILE_KEY = "zc_ops_active_profile_v1";

const STARTER_HTML_TEMPLATE = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px; border: 1px solid #e5e7eb; border-radius: 8px; color: #111827;">
  <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600;">Hello,</h2>
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #374151;">
    Your account notification is ready. Please review the details below at your convenience.
  </p>
  <p style="margin: 24px 0 0; font-size: 12px; color: #6b7280;">
    Sent via Zoho Catalyst Transactional Email
  </p>
</div>`;

function formatHHMMSS(sec) {
  const safe = !Number.isFinite(sec) || sec < 0 ? 0 : Math.floor(sec);
  const h = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function parseRecipientLine(rawLine, defaultFirst = "Bulk", defaultLast = "User") {
  const trimmed = String(rawLine || "").trim();
  if (!trimmed) return null;

  // Support CSV / semicolon / tab separated: email,firstName,lastName
  const parts = trimmed
    .split(/[,;\t]+/)
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  if (parts.length === 0) return null;

  // Find column containing '@'
  const emailIdx = parts.findIndex((p) => p.includes("@") && p.includes("."));
  if (emailIdx === -1) return null;

  const rawEmail = parts[emailIdx];
  // Extract from "Name <email@domain.com>" if formatted that way
  const angleMatch = rawEmail.match(/<([^>]+@[^>]+)>/);
  const email = (angleMatch ? angleMatch[1] : rawEmail).trim();

  const otherParts = parts.filter((_, idx) => idx !== emailIdx);
  const firstName = otherParts[0] || defaultFirst;
  const lastName = otherParts.slice(1).join(" ") || defaultLast;
  const displayName = otherParts.length > 0 ? otherParts.join(" ") : email.split("@")[0];

  return { raw: trimmed, email, firstName, lastName, name: displayName };
}

function applyMergeTags(template, item, index) {
  if (!template || !template.includes("{{")) return template;
  return template
    .replace(/\{\{\s*email\s*\}\}/gi, item.email || "")
    .replace(/\{\{\s*first_?name\s*\}\}/gi, item.firstName || "")
    .replace(/\{\{\s*last_?name\s*\}\}/gi, item.lastName || "")
    .replace(/\{\{\s*name\s*\}\}/gi, item.name || "")
    .replace(/\{\{\s*index\s*\}\}/gi, String(index + 1));
}

function normalizeImportedProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const profileName = String(raw.profileName || raw.profile_name || "").trim();
  const clientId = String(raw.clientId || raw.client_id || "").trim();
  const clientSecret = String(raw.clientSecret || raw.client_secret || "").trim();
  const refreshToken = String(raw.refreshToken || raw.refresh_token || "").trim();
  const projectId = String(raw.projectId || raw.project_id || "").trim();
  const fromEmail = String(raw.fromEmail || raw.from_email || "").trim();
  const dc = String(raw.dc || "com").trim() || "com";

  if (!profileName || !clientId || !clientSecret || !refreshToken) return null;
  return {
    profileName,
    clientId,
    clientSecret,
    refreshToken,
    projectId,
    fromEmail,
    dc,
  };
}

export default function CatalystConsole() {
  // Profiles state
  const [profiles, setProfiles] = useState([]);
  const [activeProfileName, setActiveProfileName] = useState("");
  const [hydrated, setHydrated] = useState(false);

  // Navigation & Modals
  const [currentTab, setCurrentTab] = useState("email");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileToEdit, setProfileToEdit] = useState(null);
  const [htmlPreviewOpen, setHtmlPreviewOpen] = useState(false);
  const [inspectedLog, setInspectedLog] = useState(null);

  // Email Dispatch inputs
  const [emailSubject, setEmailSubject] = useState("");
  const [emailDisplayName, setEmailDisplayName] = useState("");
  const [emailFromOverride, setEmailFromOverride] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [emailBulkText, setEmailBulkText] = useState("");

  // Bulk Signup inputs
  const [firstNameInput, setFirstNameInput] = useState("Bulk");
  const [lastNameInput, setLastNameInput] = useState("User");
  const [signupBulkText, setSignupBulkText] = useState("");

  // Execution engine parameters
  const [delaySec, setDelaySec] = useState("0");
  const [concurrency, setConcurrency] = useState("1");
  const [stopFailures, setStopFailures] = useState("4");
  const [logMode, setLogMode] = useState("failures"); // "failures" | "all"

  // Live Job UI State
  const [jobState, setJobState] = useState("idle"); // "idle" | "running" | "paused"
  const [metrics, setMetrics] = useState({
    total: 0,
    processed: 0,
    remaining: 0,
    success: 0,
    failed: 0,
    elapsedSec: 0,
    remainingSec: 0,
    ratePerSec: 0,
  });
  const [logs, setLogs] = useState([]);
  const [failedItems, setFailedItems] = useState([]);

  // User Directory State
  const [usersList, setUsersList] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersPage, setUsersPage] = useState(1);
  const [usersPerPage, setUsersPerPage] = useState(50);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [deletingIds, setDeletingIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  // Toasts
  const [toasts, setToasts] = useState([]);

  // Refs for file pickers & concurrent engine
  const txtCsvInputRef = useRef(null);
  const importTargetRef = useRef("email");
  const profilesJsonInputRef = useRef(null);
  const jobRef = useRef(null);
  const timerRef = useRef(null);

  const showToast = useCallback((title, message, type = "info") => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5500);
  }, []);

  // Load saved profiles from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PROFILES_KEY);
      const savedActive = localStorage.getItem(STORAGE_ACTIVE_PROFILE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setProfiles(parsed);
          const match = parsed.find((p) => p.profileName === savedActive);
          setActiveProfileName(match ? match.profileName : parsed[0].profileName);
        }
      }
    } catch {
      // ignore storage errors
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist profiles whenever changed
  const persistProfiles = useCallback((nextProfiles, nextActiveName) => {
    setProfiles(nextProfiles);
    setActiveProfileName(nextActiveName);
    try {
      localStorage.setItem(STORAGE_PROFILES_KEY, JSON.stringify(nextProfiles));
      localStorage.setItem(STORAGE_ACTIVE_PROFILE_KEY, nextActiveName || "");
    } catch {
      // ignore storage errors
    }
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.profileName === activeProfileName) || null,
    [profiles, activeProfileName]
  );

  // Parsed recipient / signup counts
  const parsedEmailItems = useMemo(
    () =>
      emailBulkText
        .split(/\r?\n/)
        .map((line) => parseRecipientLine(line))
        .filter(Boolean),
    [emailBulkText]
  );

  const parsedSignupItems = useMemo(
    () =>
      signupBulkText
        .split(/\r?\n/)
        .map((line) =>
          parseRecipientLine(
            line,
            firstNameInput.trim() || "Bulk",
            lastNameInput.trim() || "User"
          )
        )
        .filter(Boolean),
    [signupBulkText, firstNameInput, lastNameInput]
  );

  // Sync remaining counter when idle
  useEffect(() => {
    if (jobState === "idle") {
      const count =
        currentTab === "email"
          ? parsedEmailItems.length
          : currentTab === "signup"
          ? parsedSignupItems.length
          : 0;
      setMetrics((prev) => ({
        ...prev,
        total: count,
        remaining: count,
      }));
    }
  }, [currentTab, jobState, parsedEmailItems.length, parsedSignupItems.length]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (jobRef.current) jobRef.current.aborted = true;
    };
  }, []);

  // =========================================================================
  // Profile CRUD + JSON Backup Export / Import
  // =========================================================================
  const handleSaveProfile = (cleanedProfile, originalName) => {
    let updated;
    if (originalName) {
      updated = profiles.map((p) =>
        p.profileName === originalName ? cleanedProfile : p
      );
      // If renamed and collided with another entry, deduplicate
      updated = updated.filter(
        (p, idx) =>
          updated.findIndex((x) => x.profileName === p.profileName) === idx
      );
    } else {
      const existingIdx = profiles.findIndex(
        (p) => p.profileName === cleanedProfile.profileName
      );
      if (existingIdx >= 0) {
        updated = [...profiles];
        updated[existingIdx] = cleanedProfile;
      } else {
        updated = [...profiles, cleanedProfile];
      }
    }

    persistProfiles(updated, cleanedProfile.profileName);
    setProfileModalOpen(false);
    showToast(
      "Profile Saved",
      `Active profile set to "${cleanedProfile.profileName}".`,
      "success"
    );
  };

  const handleDeleteProfile = (nameToDelete) => {
    const remaining = profiles.filter((p) => p.profileName !== nameToDelete);
    const nextActive = remaining[0]?.profileName || "";
    persistProfiles(remaining, nextActive);
    setProfileModalOpen(false);
    showToast("Profile Deleted", `Removed "${nameToDelete}".`, "warning");
  };

  const stepProfile = (dir) => {
    if (jobState !== "idle") {
      showToast(
        "Execution Active",
        "Pause or abort the current job before switching profiles.",
        "warning"
      );
      return;
    }
    if (profiles.length <= 1) return;
    const idx = profiles.findIndex((p) => p.profileName === activeProfileName);
    const nextIdx =
      idx + dir < 0
        ? profiles.length - 1
        : idx + dir >= profiles.length
        ? 0
        : idx + dir;
    const nextName = profiles[nextIdx].profileName;
    setActiveProfileName(nextName);
    try {
      localStorage.setItem(STORAGE_ACTIVE_PROFILE_KEY, nextName);
    } catch {
      // ignore
    }
  };

  const exportProfilesJson = () => {
    if (profiles.length === 0) {
      showToast("No Profiles", "Add at least one profile before exporting.", "warning");
      return;
    }
    const blob = new Blob([JSON.stringify(profiles, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalyst-profiles-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(
      "Profiles Exported",
      `Downloaded ${profiles.length} profile(s) to JSON backup.`,
      "success"
    );
  };

  const handleImportProfilesJson = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || "[]"));
        const rawList = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.profiles)
          ? parsed.profiles
          : Array.isArray(parsed?.results)
          ? parsed.results
          : [parsed];

        const valid = rawList.map(normalizeImportedProfile).filter(Boolean);
        if (valid.length === 0) {
          showToast(
            "Invalid Backup File",
            "No valid profile objects found in the selected JSON file.",
            "error"
          );
          return;
        }

        const mergedMap = new Map(profiles.map((p) => [p.profileName, p]));
        valid.forEach((p) => mergedMap.set(p.profileName, p));
        const merged = Array.from(mergedMap.values());
        const nextActive = activeProfileName || merged[0]?.profileName || "";
        persistProfiles(merged, nextActive);
        showToast(
          "Profiles Imported",
          `Imported ${valid.length} profile(s) into local storage.`,
          "success"
        );
      } catch (err) {
        showToast("JSON Parse Error", err.message, "error");
      }
    };
    reader.readAsText(file);
  };

  // =========================================================================
  // TXT / CSV List Import & Deduplication
  // =========================================================================
  const triggerListImport = (target) => {
    importTargetRef.current = target;
    txtCsvInputRef.current?.click();
  };

  const handleTxtCsvImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = String(ev.target?.result || "");
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l.includes("@"));

      if (lines.length === 0) {
        showToast(
          "No Valid Emails Found",
          "The selected file did not contain lines with valid email addresses.",
          "warning"
        );
        return;
      }

      if (importTargetRef.current === "email") {
        setEmailBulkText((prev) =>
          prev.trim() ? `${prev.trim()}\n${lines.join("\n")}` : lines.join("\n")
        );
      } else {
        setSignupBulkText((prev) =>
          prev.trim() ? `${prev.trim()}\n${lines.join("\n")}` : lines.join("\n")
        );
      }

      showToast(
        "List Imported",
        `Loaded ${lines.length} entries from ${file.name}.`,
        "success"
      );
    };
    reader.readAsText(file);
  };

  const deduplicateList = (target) => {
    const raw = target === "email" ? emailBulkText : signupBulkText;
    const lines = raw.split(/\r?\n/);
    const seen = new Set();
    const kept = [];
    let removed = 0;

    for (const line of lines) {
      const parsed = parseRecipientLine(line);
      if (!parsed) continue;
      const key = parsed.email.toLowerCase();
      if (seen.has(key)) {
        removed += 1;
      } else {
        seen.add(key);
        kept.push(line.trim());
      }
    }

    if (target === "email") setEmailBulkText(kept.join("\n"));
    else setSignupBulkText(kept.join("\n"));

    showToast(
      "List Cleaned",
      `Retained ${kept.length} unique emails (${removed} duplicate${
        removed === 1 ? "" : "s"
      } removed).`,
      "info"
    );
  };

  // =========================================================================
  // Concurrent Batch Execution Engine (Email & Signup)
  // =========================================================================
  const appendLog = useCallback((entry) => {
    setLogs((prev) => [entry, ...prev.slice(0, 999)]);
  }, []);

  const stopTimerInterval = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimerInterval = useCallback(
    (delayVal) => {
      stopTimerInterval();
      timerRef.current = setInterval(() => {
        const job = jobRef.current;
        if (!job || job.paused || job.aborted || !job.runStartedAt) return;

        const currentRunSec = (Date.now() - job.runStartedAt) / 1000;
        const totalElapsed = job.elapsedOffsetSec + currentRunSec;
        const remainingItems = Math.max(0, job.items.length - job.processed);
        const rate =
          totalElapsed > 0.25 ? job.processed / totalElapsed : 0;
        const avgSecPerItem =
          job.processed > 0
            ? totalElapsed / job.processed
            : Math.max(0.25, delayVal);
        const estRemaining =
          remainingItems <= 0 ? 0 : Math.ceil(remainingItems * avgSecPerItem);

        setMetrics({
          total: job.items.length,
          processed: job.processed,
          remaining: remainingItems,
          success: job.success,
          failed: job.failed,
          elapsedSec: Math.floor(totalElapsed),
          remainingSec: estRemaining,
          ratePerSec: rate,
        });
      }, 400);
    },
    [stopTimerInterval]
  );

  const finishOrAbortJob = useCallback(
    (toastTitle, toastMsg, toastType = "info") => {
      const job = jobRef.current;
      if (job) {
        job.aborted = true;
        job.paused = false;
      }
      stopTimerInterval();
      setJobState("idle");
      if (job) {
        const totalElapsed =
          job.elapsedOffsetSec +
          (job.runStartedAt ? (Date.now() - job.runStartedAt) / 1000 : 0);
        setMetrics({
          total: job.items.length,
          processed: job.processed,
          remaining: Math.max(0, job.items.length - job.processed),
          success: job.success,
          failed: job.failed,
          elapsedSec: Math.floor(totalElapsed),
          remainingSec: 0,
          ratePerSec: 0,
        });
        setFailedItems([...job.failedList]);
      }
      jobRef.current = null;
      if (toastTitle) {
        showToast(toastTitle, toastMsg, toastType);
      }
    },
    [showToast, stopTimerInterval]
  );

  const startBatchJob = async (overrideItems = null) => {
    if (jobState === "running") return;

    // If resuming from paused state
    if (jobState === "paused" && jobRef.current) {
      togglePauseJob();
      return;
    }

    if (!activeProfile) {
      showToast(
        "No Active Profile",
        "Configure a Zoho Catalyst profile first via Manage Profiles.",
        "error"
      );
      setProfileToEdit(null);
      setProfileModalOpen(true);
      return;
    }

    if (!activeProfile.projectId) {
      showToast(
        "Missing Project ID",
        `Profile "${activeProfile.profileName}" has no Catalyst Project ID configured.`,
        "error"
      );
      setProfileToEdit(activeProfile);
      setProfileModalOpen(true);
      return;
    }

    const delayVal = Math.max(0, parseFloat(delaySec) || 0);
    const rawConc = Math.min(25, Math.max(1, parseInt(concurrency, 10) || 1));
    const maxConsecutiveErr = Math.max(0, parseInt(stopFailures, 10) || 0);

    let itemsToRun = [];
    let resolvedFromEmail = "";

    if (currentTab === "email") {
      resolvedFromEmail = (emailFromOverride.trim() || activeProfile.fromEmail || "").trim();
      if (!resolvedFromEmail) {
        showToast(
          "Missing Sender Email",
          "Set a Verified From Email in your profile or in the Sender Override field.",
          "error"
        );
        return;
      }
      if (!emailSubject.trim()) {
        showToast(
          "Subject Required",
          "Enter an email subject line before starting dispatch.",
          "error"
        );
        return;
      }
      itemsToRun = overrideItems || parsedEmailItems;
      if (itemsToRun.length === 0) {
        showToast(
          "No Recipients",
          "Add at least one valid recipient email address.",
          "error"
        );
        return;
      }
    } else if (currentTab === "signup") {
      itemsToRun = overrideItems || parsedSignupItems;
      if (itemsToRun.length === 0) {
        showToast(
          "No Target Emails",
          "Add at least one email address to register.",
          "error"
        );
        return;
      }
    } else {
      return;
    }

    // Initialize clean run state
    setLogs([]);
    setFailedItems([]);
    setMetrics({
      total: itemsToRun.length,
      processed: 0,
      remaining: itemsToRun.length,
      success: 0,
      failed: 0,
      elapsedSec: 0,
      remainingSec: 0,
      ratePerSec: 0,
    });

    const job = {
      type: currentTab,
      profile: activeProfile,
      projectId: activeProfile.projectId,
      fromEmail: resolvedFromEmail,
      subject: emailSubject.trim(),
      displayName: emailDisplayName.trim(),
      replyTo: emailReplyTo.trim(),
      content: emailContent,
      items: itemsToRun,
      nextIndex: 0,
      processed: 0,
      success: 0,
      failed: 0,
      consecutiveErrors: 0,
      failedList: [],
      accessToken: null,
      paused: false,
      aborted: false,
      runStartedAt: Date.now(),
      elapsedOffsetSec: 0,
      logAll: logMode === "all",
    };

    jobRef.current = job;
    setJobState("running");

    // Pre-fetch OAuth access token once before spawning parallel workers
    try {
      const tokRes = await fetch("/api/catalyst/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: activeProfile }),
      });
      const tokData = await tokRes.json();
      if (tokRes.ok && tokData.success && tokData.accessToken) {
        job.accessToken = tokData.accessToken;
      } else if (!tokRes.ok || tokData.error) {
        finishOrAbortJob(
          "OAuth Handshake Failed",
          tokData.error || "Unable to fetch access token for this profile.",
          "error"
        );
        return;
      }
    } catch (err) {
      finishOrAbortJob("Network Error", err.message, "error");
      return;
    }

    job.runStartedAt = Date.now();
    startTimerInterval(delayVal);

    const workerCount =
      delayVal > 0 ? 1 : Math.min(rawConc, itemsToRun.length);

    const triggerAutoPause = (reason) => {
      if (job.paused || job.aborted) return;
      job.paused = true;
      if (job.runStartedAt) {
        job.elapsedOffsetSec += (Date.now() - job.runStartedAt) / 1000;
        job.runStartedAt = null;
      }
      setJobState("paused");
      setFailedItems([...job.failedList]);
      showToast("Job Auto-Paused", reason, "warning");
    };

    const workerLoop = async () => {
      while (!job.aborted) {
        while (job.paused && !job.aborted) {
          await new Promise((r) => setTimeout(r, 180));
        }
        if (job.aborted) break;

        if (job.nextIndex >= job.items.length) break;
        const currentIndex = job.nextIndex++;
        const item = job.items[currentIndex];
        const reqStart = Date.now();

        try {
          let res;
          if (job.type === "email") {
            res = await fetch("/api/catalyst/email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                profile: job.profile,
                accessToken: job.accessToken,
                projectId: job.projectId,
                fromEmail: job.fromEmail,
                recipientEmail: item.email,
                subject: applyMergeTags(job.subject, item, currentIndex),
                content: applyMergeTags(job.content, item, currentIndex),
                displayName: job.displayName,
                replyTo: job.replyTo,
              }),
            });
          } else {
            res = await fetch("/api/catalyst/signup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                profile: job.profile,
                accessToken: job.accessToken,
                projectId: job.projectId,
                email: item.email,
                firstName: item.firstName,
                lastName: item.lastName,
              }),
            });
          }

          const data = await res.json();
          if (data.newAccessToken) {
            job.accessToken = data.newAccessToken;
          }

          if (data.success) {
            job.success += 1;
            job.consecutiveErrors = 0;
            if (job.logAll) {
              appendLog({
                id: `${Date.now()}_${currentIndex}`,
                profileName: job.profile.profileName,
                identifier: item.email,
                details:
                  job.type === "email"
                    ? "Dispatched OK"
                    : "User provisioned OK",
                ok: true,
                time: new Date().toLocaleTimeString(),
                payload: data.fullResponse || { status: "success" },
              });
            }
          } else {
            job.failed += 1;
            job.consecutiveErrors += 1;
            job.failedList.push(item);
            appendLog({
              id: `${Date.now()}_${currentIndex}`,
              profileName: job.profile.profileName,
              identifier: item.email,
              details: data.error || "Catalyst request rejected",
              ok: false,
              time: new Date().toLocaleTimeString(),
              payload: data.fullResponse || data,
            });

            if (
              maxConsecutiveErr > 0 &&
              job.consecutiveErrors >= maxConsecutiveErr &&
              !job.paused
            ) {
              triggerAutoPause(
                `Paused automatically after ${job.consecutiveErrors} consecutive errors.`
              );
            }
          }
        } catch (err) {
          job.failed += 1;
          job.consecutiveErrors += 1;
          job.failedList.push(item);
          appendLog({
            id: `${Date.now()}_${currentIndex}`,
            profileName: job.profile.profileName,
            identifier: item.email,
            details: `Network Error: ${err.message}`,
            ok: false,
            time: new Date().toLocaleTimeString(),
            payload: { error: err.message },
          });

          if (
            maxConsecutiveErr > 0 &&
            job.consecutiveErrors >= maxConsecutiveErr &&
            !job.paused
          ) {
            triggerAutoPause(
              `Paused automatically after ${job.consecutiveErrors} consecutive network errors.`
            );
          }
        }

        job.processed += 1;
        setMetrics((prev) => ({
          ...prev,
          processed: job.processed,
          remaining: Math.max(0, job.items.length - job.processed),
          success: job.success,
          failed: job.failed,
        }));

        if (delayVal > 0 && !job.aborted && !job.paused) {
          const elapsedMs = Date.now() - reqStart;
          const waitMs = Math.max(0, delayVal * 1000 - elapsedMs);
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

    if (!job.aborted && job.nextIndex >= job.items.length) {
      finishOrAbortJob(
        "Batch Complete",
        `Processed ${job.processed} items (${job.success} succeeded, ${job.failed} failed).`,
        job.failed === 0 ? "success" : "warning"
      );
    }
  };

  const togglePauseJob = () => {
    const job = jobRef.current;
    if (!job) return;

    if (!job.paused) {
      job.paused = true;
      if (job.runStartedAt) {
        job.elapsedOffsetSec += (Date.now() - job.runStartedAt) / 1000;
        job.runStartedAt = null;
      }
      setJobState("paused");
      setFailedItems([...job.failedList]);
      showToast("Execution Paused", "Workers suspended cleanly.", "warning");
    } else {
      job.paused = false;
      job.consecutiveErrors = 0;
      job.runStartedAt = Date.now();
      job.logAll = logMode === "all";
      setJobState("running");
      showToast("Execution Resumed", "Workers resumed processing.", "info");
    }
  };

  const retryFailedBatch = () => {
    if (failedItems.length === 0) return;
    const rawLines = failedItems.map((it) => it.raw).join("\n");
    if (currentTab === "email") {
      setEmailBulkText(rawLines);
    } else if (currentTab === "signup") {
      setSignupBulkText(rawLines);
    }
    const snapshot = [...failedItems];
    startBatchJob(snapshot);
  };

  const exportFailedTxt = () => {
    if (failedItems.length === 0) return;
    const content = failedItems.map((i) => i.raw).join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `failed-${currentTab}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetConsoleState = () => {
    if (jobRef.current) {
      jobRef.current.aborted = true;
      jobRef.current = null;
    }
    stopTimerInterval();
    setJobState("idle");
    setLogs([]);
    setFailedItems([]);
    const count =
      currentTab === "email"
        ? parsedEmailItems.length
        : currentTab === "signup"
        ? parsedSignupItems.length
        : 0;
    setMetrics({
      total: count,
      processed: 0,
      remaining: count,
      success: 0,
      failed: 0,
      elapsedSec: 0,
      remainingSec: 0,
      ratePerSec: 0,
    });
    showToast("State Reset", "Telemetry counters and logs cleared.", "info");
  };

  // =========================================================================
  // Catalyst User Directory Management (Fetch, Pagination, Single & Bulk Delete)
  // =========================================================================
  const fetchDirectoryUsers = useCallback(
    async (pageToLoad = 1, perPageToLoad = usersPerPage) => {
      if (!activeProfile) {
        showToast(
          "Select a Profile",
          "Add or select a Zoho Catalyst profile first.",
          "warning"
        );
        return;
      }
      if (!activeProfile.projectId) {
        showToast(
          "Missing Project ID",
          `Profile "${activeProfile.profileName}" requires a Project ID.`,
          "error"
        );
        return;
      }

      setUsersLoading(true);
      setSelectedUserIds(new Set());

      try {
        const res = await fetch("/api/catalyst/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: activeProfile,
            projectId: activeProfile.projectId,
            page: pageToLoad,
            perPage: perPageToLoad,
          }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          setUsersList(Array.isArray(data.users) ? data.users : []);
          setUsersPage(pageToLoad);
          setUsersHasMore(Boolean(data.hasMore));
        } else {
          setUsersList([]);
          showToast(
            "Directory Fetch Failed",
            data.error || "Could not load project users.",
            "error"
          );
        }
      } catch (err) {
        showToast("Network Error", err.message, "error");
      } finally {
        setUsersLoading(false);
      }
    },
    [activeProfile, showToast, usersPerPage]
  );

  useEffect(() => {
    if (hydrated && currentTab === "users" && activeProfile?.projectId) {
      fetchDirectoryUsers(1, usersPerPage);
    }
  }, [hydrated, currentTab, activeProfileName, activeProfile?.projectId, usersPerPage, fetchDirectoryUsers]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return usersList;
    return usersList.filter((u) => {
      const uid = String(u.user_id || u.zuid || u.id || "").toLowerCase();
      const email = String(u.email_id || u.email || "").toLowerCase();
      const name = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      return uid.includes(q) || email.includes(q) || name.includes(q);
    });
  }, [usersList, userSearch]);

  const handleDeleteSingleUser = async (userId) => {
    if (!activeProfile || !userId) return;
    setDeletingIds((prev) => new Set(prev).add(userId));

    try {
      const res = await fetch("/api/catalyst/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: activeProfile,
          projectId: activeProfile.projectId,
          userId,
        }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setUsersList((prev) =>
          prev.filter(
            (u) => String(u.user_id || u.zuid || u.id) !== String(userId)
          )
        );
        setSelectedUserIds((prev) => {
          const next = new Set(prev);
          next.delete(String(userId));
          return next;
        });
        showToast("User Deleted", `Removed user ID ${userId}.`, "success");
      } else {
        showToast(
          "Delete Failed",
          data.error || "Catalyst rejected user deletion.",
          "error"
        );
      }
    } catch (err) {
      showToast("Error", err.message, "error");
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const handleBulkDeleteUsers = async () => {
    const ids = Array.from(selectedUserIds);
    if (!activeProfile || ids.length === 0 || bulkDeleting) return;

    setBulkDeleting(true);
    let deletedCount = 0;
    let failCount = 0;
    let cachedTok = null;

    for (const uid of ids) {
      setDeletingIds((prev) => new Set(prev).add(uid));
      try {
        const res = await fetch("/api/catalyst/users/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: activeProfile,
            accessToken: cachedTok,
            projectId: activeProfile.projectId,
            userId: uid,
          }),
        });
        const data = await res.json();
        if (data.newAccessToken) cachedTok = data.newAccessToken;

        if (res.ok && data.success) {
          deletedCount += 1;
          setUsersList((prev) =>
            prev.filter(
              (u) => String(u.user_id || u.zuid || u.id) !== String(uid)
            )
          );
          setSelectedUserIds((prev) => {
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
        } else {
          failCount += 1;
        }
      } catch {
        failCount += 1;
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      }
    }

    setBulkDeleting(false);
    showToast(
      "Bulk Delete Finished",
      `Deleted ${deletedCount} user(s)${
        failCount > 0 ? `, ${failCount} failed` : ""
      }.`,
      failCount === 0 ? "success" : "warning"
    );
  };

  const toggleSelectAllUsers = () => {
    if (selectedUserIds.size === filteredUsers.length && filteredUsers.length > 0) {
      setSelectedUserIds(new Set());
    } else {
      const next = new Set(
        filteredUsers
          .map((u) => String(u.user_id || u.zuid || u.id || ""))
          .filter(Boolean)
      );
      setSelectedUserIds(next);
    }
  };

  const switchWorkspaceTab = (tab) => {
    if (jobState !== "idle") {
      showToast(
        "Job Running",
        "Pause and abort the active batch job before switching modules.",
        "warning"
      );
      return;
    }
    setCurrentTab(tab);
  };

  const progressPct =
    metrics.total > 0
      ? Math.min(100, (metrics.processed / metrics.total) * 100)
      : 0;
  const successRatePct =
    metrics.processed > 0
      ? Math.round((metrics.success / metrics.processed) * 100)
      : 100;

  return (
    <div className="min-h-screen flex flex-col bg-[#09090B] text-zinc-100">
      {/* Hidden File Inputs */}
      <input
        ref={txtCsvInputRef}
        type="file"
        accept=".txt,.csv"
        className="hidden"
        onChange={handleTxtCsvImport}
      />
      <input
        ref={profilesJsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportProfilesJson}
      />

      {/* Toast Notification Stack */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-full max-w-sm pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto panel-surface rounded-lg px-4 py-3 flex items-start gap-3 border-l-2 shadow-2xl ${
              t.type === "error"
                ? "border-l-rose-500"
                : t.type === "warning"
                ? "border-l-amber-500"
                : t.type === "success"
                ? "border-l-emerald-500"
                : "border-l-blue-500"
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-100 tracking-tight">
                {t.title}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed break-words">
                {t.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setToasts((prev) => prev.filter((item) => item.id !== t.id))
              }
              className="text-zinc-500 hover:text-zinc-200 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Top Architectural Header */}
      <header className="sticky top-0 z-40 bg-[#09090B]/90 backdrop-blur-md border-b border-zinc-800/90">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-gradient-to-b from-blue-500 to-blue-600 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.35)] shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-sm font-semibold tracking-tight text-zinc-100 truncate">
                  Catalyst Operations Console
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border ${
                    jobState === "running"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : jobState === "paused"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      jobState === "running"
                        ? "bg-emerald-400 animate-pulse"
                        : jobState === "paused"
                        ? "bg-amber-400"
                        : "bg-zinc-500"
                    }`}
                  />
                  {jobState}
                </span>
              </div>
            </div>
          </div>

          {/* Right Command Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => profilesJsonInputRef.current?.click()}
              title="Import profiles from JSON backup"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
            >
              <Upload className="w-3.5 h-3.5 text-zinc-400" />
              <span>Import</span>
            </button>

            <button
              type="button"
              onClick={exportProfilesJson}
              title="Export profiles to JSON backup"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
            >
              <Download className="w-3.5 h-3.5 text-zinc-400" />
              <span>Backup</span>
            </button>

            <button
              type="button"
              onClick={resetConsoleState}
              title="Clear counters and event logs"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
            >
              <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
              <span className="hidden md:inline">Reset State</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setProfileToEdit(activeProfile || null);
                setProfileModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Profiles</span>
              <span className="px-1.5 py-0.2 rounded bg-blue-700/80 font-mono text-[10px]">
                {profiles.length}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Secondary Sub-Bar: Segmented Module Switcher + Quick Profile Selector */}
      <div className="border-b border-zinc-800/80 bg-[#0C0C10]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Module Tabs */}
          <nav className="inline-flex p-1 rounded-lg bg-[#09090B] border border-zinc-800/90 self-start">
            <button
              type="button"
              onClick={() => switchWorkspaceTab("email")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition ${
                currentTab === "email"
                  ? "bg-zinc-800/90 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Mail className="w-3.5 h-3.5 text-blue-400" />
              <span>Bulk Email Dispatch</span>
            </button>

            <button
              type="button"
              onClick={() => switchWorkspaceTab("signup")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition ${
                currentTab === "signup"
                  ? "bg-zinc-800/90 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Bulk User Signup</span>
            </button>

            <button
              type="button"
              onClick={() => switchWorkspaceTab("users")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition ${
                currentTab === "users"
                  ? "bg-zinc-800/90 text-zinc-100 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span>User Directory</span>
            </button>
          </nav>

          {/* Active Profile Bar */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider hidden xl:inline">
              Active Account:
            </span>
            <div className="flex items-center gap-1.5 flex-1 md:flex-initial">
              <button
                type="button"
                onClick={() => stepProfile(-1)}
                disabled={profiles.length <= 1 || jobState !== "idle"}
                title="Previous profile"
                className="p-1.5 rounded-md bg-[#09090B] hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <select
                value={activeProfileName}
                disabled={jobState !== "idle"}
                onChange={(e) => {
                  setActiveProfileName(e.target.value);
                  try {
                    localStorage.setItem(
                      STORAGE_ACTIVE_PROFILE_KEY,
                      e.target.value
                    );
                  } catch {
                    // ignore
                  }
                }}
                className="bg-[#09090B] border border-zinc-800 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-200 min-w-[210px] outline-none focus:border-blue-500/70"
              >
                {profiles.length === 0 ? (
                  <option value="">No profiles configured — click +</option>
                ) : (
                  profiles.map((p) => (
                    <option key={p.profileName} value={p.profileName}>
                      {p.profileName} (.{p.dc || "com"})
                      {p.projectId ? ` • ${p.projectId}` : ""}
                    </option>
                  ))
                )}
              </select>

              <button
                type="button"
                onClick={() => stepProfile(1)}
                disabled={profiles.length <= 1 || jobState !== "idle"}
                title="Next profile"
                className="p-1.5 rounded-md bg-[#09090B] hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 disabled:opacity-40 transition"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setProfileToEdit(null);
                  setProfileModalOpen(true);
                }}
                title="Add new profile"
                className="p-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 hover:text-blue-300 transition"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Grid */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Configuration & Payload Studio */}
        <section className="lg:col-span-5 space-y-5">
          <div className="panel-surface rounded-lg p-5 space-y-4">
            {/* Active Profile Metadata Strip */}
            <div className="flex items-center justify-between gap-2 pb-3.5 border-b border-zinc-800/80">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {currentTab === "email"
                    ? "Email Campaign Parameters"
                    : currentTab === "signup"
                    ? "User Provisioning Parameters"
                    : "Project Directory Controls"}
                </p>
                <p className="text-xs font-mono text-zinc-400 truncate mt-0.5">
                  {activeProfile
                    ? `Proj: ${activeProfile.projectId || "Unset"} • ${
                        activeProfile.fromEmail || "No sender email"
                      }`
                    : "No profile selected"}
                </p>
              </div>
              {activeProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setProfileToEdit(activeProfile);
                    setProfileModalOpen(true);
                  }}
                  className="shrink-0 text-xs font-medium text-blue-400 hover:text-blue-300 transition"
                >
                  Edit Profile
                </button>
              )}
            </div>

            {/* MODULE 1: BULK EMAIL SENDER */}
            {currentTab === "email" && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-300">
                      Subject Line
                    </label>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Supports {"{{name}}"}, {"{{email}}"}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Important account update"
                    className="input-sharp w-full"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Sender Display Name
                    </label>
                    <input
                      type="text"
                      value={emailDisplayName}
                      onChange={(e) => setEmailDisplayName(e.target.value)}
                      placeholder="Support Team"
                      className="input-sharp w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Sender Override{" "}
                      <span className="text-zinc-500 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      value={emailFromOverride}
                      onChange={(e) => setEmailFromOverride(e.target.value)}
                      placeholder={
                        activeProfile?.fromEmail || "Defaults to profile From Email"
                      }
                      className="input-sharp w-full font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Reply-To Address{" "}
                    <span className="text-zinc-500 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={emailReplyTo}
                    onChange={(e) => setEmailReplyTo(e.target.value)}
                    placeholder="support@yourdomain.com"
                    className="input-sharp w-full font-mono text-xs"
                  />
                </div>

                {/* HTML Content */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-zinc-400" />
                      HTML Body
                    </label>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setEmailContent((prev) =>
                            prev.trim() ? prev : STARTER_HTML_TEMPLATE
                          )
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
                      >
                        <Sparkles className="w-3 h-3" />
                        Starter HTML
                      </button>
                      <button
                        type="button"
                        onClick={() => setHtmlPreviewOpen(true)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Preview Render
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={5}
                    value={emailContent}
                    onChange={(e) => setEmailContent(e.target.value)}
                    placeholder="<p>Hello {{name}}, welcome aboard!</p>"
                    className="input-sharp w-full font-mono text-xs leading-relaxed resize-y"
                  />
                </div>

                {/* Recipients List */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-medium text-zinc-300">
                      Recipients Queue
                    </label>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => triggerListImport("email")}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 transition"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Import TXT/CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => deduplicateList("email")}
                        className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
                      >
                        Deduplicate
                      </button>
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 tabular-nums">
                        {parsedEmailItems.length} valid
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={6}
                    value={emailBulkText}
                    onChange={(e) => setEmailBulkText(e.target.value)}
                    placeholder={"user1@example.com\nuser2@example.com,Jane,Doe"}
                    className="input-sharp w-full font-mono text-xs leading-relaxed resize-y"
                  />
                </div>
              </div>
            )}

            {/* MODULE 2: BULK USER SIGNUP */}
            {currentTab === "signup" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Default First Name
                    </label>
                    <input
                      type="text"
                      value={firstNameInput}
                      onChange={(e) => setFirstNameInput(e.target.value)}
                      className="input-sharp w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Default Last Name
                    </label>
                    <input
                      type="text"
                      value={lastNameInput}
                      onChange={(e) => setLastNameInput(e.target.value)}
                      className="input-sharp w-full"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-medium text-zinc-300">
                      Target Emails Queue
                    </label>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => triggerListImport("signup")}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 transition"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5" />
                        Import TXT/CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => deduplicateList("signup")}
                        className="text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
                      >
                        Deduplicate
                      </button>
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300 tabular-nums">
                        {parsedSignupItems.length} valid
                      </span>
                    </div>
                  </div>
                  <textarea
                    rows={9}
                    value={signupBulkText}
                    onChange={(e) => setSignupBulkText(e.target.value)}
                    placeholder={
                      "member1@example.com\nmember2@example.com,Alex,Mercer"
                    }
                    className="input-sharp w-full font-mono text-xs leading-relaxed resize-y"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1.5">
                    Format: one email per line, or{" "}
                    <code className="font-mono text-zinc-400">
                      email,FirstName,LastName
                    </code>
                    .
                  </p>
                </div>
              </div>
            )}

            {/* MODULE 3: USER DIRECTORY CONTROLS */}
            {currentTab === "users" && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Filter Loaded Users
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Filter by email, name, or 64-bit user ID..."
                      className="input-sharp w-full pl-8"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Records Per Page
                    </label>
                    <select
                      value={usersPerPage}
                      onChange={(e) => setUsersPerPage(Number(e.target.value))}
                      className="input-sharp w-full font-mono text-xs"
                    >
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                      <option value={200}>200 / page</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Current Page
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={usersPage <= 1 || usersLoading}
                        onClick={() =>
                          fetchDirectoryUsers(usersPage - 1, usersPerPage)
                        }
                        className="input-sharp px-2.5 hover:bg-zinc-900"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <div className="input-sharp flex-1 text-center font-mono text-xs">
                        Page {usersPage}
                      </div>
                      <button
                        type="button"
                        disabled={!usersHasMore || usersLoading}
                        onClick={() =>
                          fetchDirectoryUsers(usersPage + 1, usersPerPage)
                        }
                        className="input-sharp px-2.5 hover:bg-zinc-900"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => fetchDirectoryUsers(usersPage, usersPerPage)}
                  disabled={usersLoading}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white transition"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${usersLoading ? "animate-spin" : ""}`}
                  />
                  <span>
                    {usersLoading
                      ? "Querying Catalyst BaaS..."
                      : "Sync Project Users"}
                  </span>
                </button>

                {selectedUserIds.size > 0 && (
                  <button
                    type="button"
                    onClick={handleBulkDeleteUsers}
                    disabled={bulkDeleting}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white transition"
                  >
                    {bulkDeleting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {bulkDeleting
                        ? "Deleting Selected Users..."
                        : `Delete ${selectedUserIds.size} Selected User(s)`}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* PRIMARY EXECUTION CONTROLS (Email & Signup Tabs) */}
            {currentTab !== "users" && (
              <div className="pt-2">
                {jobState === "idle" ? (
                  <button
                    type="button"
                    onClick={() => startBatchJob()}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {currentTab === "email"
                        ? "Start Bulk Email Dispatch"
                        : "Start Bulk User Provisioning"}
                    </span>
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={togglePauseJob}
                      className={`inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-md text-xs font-semibold text-white transition ${
                        jobState === "paused"
                          ? "bg-emerald-600 hover:bg-emerald-500"
                          : "bg-amber-600 hover:bg-amber-500"
                      }`}
                    >
                      {jobState === "paused" ? (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Resume Batch</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-3.5 h-3.5 fill-current" />
                          <span>Pause Batch</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        finishOrAbortJob(
                          "Batch Terminated",
                          "Execution stopped by operator.",
                          "warning"
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>End Job</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: Rate Controls, Live Telemetry & Diagnostic Stream */}
        <section className="lg:col-span-7 space-y-5">
          {currentTab !== "users" && (
            <>
              {/* Concurrency & Fault-Tolerance Controls */}
              <div className="panel-surface rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Inter-Request Delay (sec)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={delaySec}
                    disabled={jobState !== "idle"}
                    onChange={(e) => setDelaySec(e.target.value)}
                    className="input-sharp w-full font-mono text-xs tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-emerald-400/90 mb-1">
                    Parallel Workers (1–25)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    value={concurrency}
                    disabled={jobState !== "idle" || Number(delaySec) > 0}
                    onChange={(e) => setConcurrency(e.target.value)}
                    className="input-sharp w-full font-mono text-xs tabular-nums border-emerald-500/30 text-emerald-300"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Auto-Pause Error Threshold
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={stopFailures}
                    disabled={jobState !== "idle"}
                    onChange={(e) => setStopFailures(e.target.value)}
                    className="input-sharp w-full font-mono text-xs tabular-nums"
                  />
                </div>
              </div>

              {/* Progress Bar & Throughput */}
              <div className="panel-surface rounded-lg px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-zinc-400">
                    <Activity className="w-3.5 h-3.5 text-blue-400" />
                    <span className="font-medium text-zinc-200">
                      Execution Progress
                    </span>
                    <span className="font-mono text-zinc-500 tabular-nums">
                      ({progressPct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-400 tabular-nums">
                    <span>
                      Throughput:{" "}
                      <strong className="text-zinc-200">
                        {metrics.ratePerSec.toFixed(1)}/s
                      </strong>
                    </span>
                    <span>
                      Yield:{" "}
                      <strong
                        className={
                          successRatePct >= 95
                            ? "text-emerald-400"
                            : "text-amber-400"
                        }
                      >
                        {successRatePct}%
                      </strong>
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      jobState === "paused" ? "bg-amber-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* 6-Card Precision Telemetry Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-zinc-600">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Processed
                  </p>
                  <p className="text-lg font-semibold font-mono text-zinc-100 mt-1 tabular-nums">
                    {metrics.processed}
                  </p>
                </div>

                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-blue-500/70">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                    Remaining
                  </p>
                  <p className="text-lg font-semibold font-mono text-blue-300 mt-1 tabular-nums">
                    {metrics.remaining}
                  </p>
                </div>

                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-emerald-500/70">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Succeeded
                  </p>
                  <p className="text-lg font-semibold font-mono text-emerald-300 mt-1 tabular-nums">
                    {metrics.success}
                  </p>
                </div>

                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-rose-500/70">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-400">
                    Failed
                  </p>
                  <p className="text-lg font-semibold font-mono text-rose-300 mt-1 tabular-nums">
                    {metrics.failed}
                  </p>
                </div>

                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-zinc-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Elapsed
                  </p>
                  <p className="text-sm font-semibold font-mono text-zinc-200 mt-2 tabular-nums">
                    {formatHHMMSS(metrics.elapsedSec)}
                  </p>
                </div>

                <div className="panel-surface rounded-lg p-3.5 border-t-2 border-t-amber-500/70">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    Est. Left
                  </p>
                  <p className="text-sm font-semibold font-mono text-amber-300 mt-2 tabular-nums">
                    {formatHHMMSS(metrics.remainingSec)}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* EVENT STREAM / USER DIRECTORY TABLE */}
          {currentTab !== "users" ? (
            <div className="panel-surface rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/90 bg-zinc-950/50 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h2 className="text-xs font-semibold text-zinc-200">
                    Diagnostic Event Stream
                  </h2>
                  <div className="inline-flex rounded bg-zinc-900 p-0.5 border border-zinc-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setLogMode("failures")}
                      className={`px-2 py-0.5 rounded transition ${
                        logMode === "failures"
                          ? "bg-zinc-800 text-zinc-100 font-medium"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      Failures Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogMode("all")}
                      className={`px-2 py-0.5 rounded transition ${
                        logMode === "all"
                          ? "bg-zinc-800 text-zinc-100 font-medium"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      All Events
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {failedItems.length > 0 && jobState === "idle" && (
                    <>
                      <button
                        type="button"
                        onClick={exportFailedTxt}
                        className="px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition"
                      >
                        Export Failed
                      </button>
                      <button
                        type="button"
                        onClick={retryFailedBatch}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry Failed ({failedItems.length})
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setLogs([])}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-800 transition"
                  >
                    Clear Log
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[480px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#09090B] text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800/90 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3.5">Profile</th>
                      <th className="py-2.5 px-3.5">Target</th>
                      <th className="py-2.5 px-3.5">Status / Diagnostic</th>
                      <th className="py-2.5 px-3.5 text-right">Timestamp</th>
                      <th className="py-2.5 px-3.5 text-center">Payload</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {logs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-12 px-4 text-center text-xs font-sans text-zinc-500"
                        >
                          {logMode === "failures"
                            ? "No failures recorded. Failed dispatches appear here automatically."
                            : "No events recorded yet. Start a batch to stream live responses."}
                        </td>
                      </tr>
                    ) : (
                      logs.map((entry) => (
                        <tr
                          key={entry.id}
                          className={
                            entry.ok
                              ? "hover:bg-zinc-900/40 text-zinc-300"
                              : "bg-rose-950/10 hover:bg-rose-950/20 text-rose-200"
                          }
                        >
                          <td className="py-2.5 px-3.5 text-zinc-400 whitespace-nowrap">
                            {entry.profileName}
                          </td>
                          <td className="py-2.5 px-3.5 font-medium truncate max-w-[180px]">
                            {entry.identifier}
                          </td>
                          <td
                            className={`py-2.5 px-3.5 break-words ${
                              entry.ok ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {entry.details}
                          </td>
                          <td className="py-2.5 px-3.5 text-right text-zinc-500 whitespace-nowrap tabular-nums">
                            {entry.time}
                          </td>
                          <td className="py-2.5 px-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => setInspectedLog(entry)}
                              className="inline-flex items-center justify-center p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 hover:text-blue-300 transition"
                              title="Inspect raw JSON payload"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* USER DIRECTORY TABLE */
            <div className="panel-surface rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/90 bg-zinc-950/50 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FolderKanban className="w-4 h-4 text-blue-400" />
                  <h2 className="text-xs font-semibold text-zinc-200">
                    Catalyst Project Users
                  </h2>
                  <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 tabular-nums">
                    {filteredUsers.length} shown
                  </span>
                </div>
                <span className="text-[11px] font-mono text-zinc-500">
                  64-Bit Safe ID Mode
                </span>
              </div>

              <div className="overflow-x-auto max-h-[580px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#09090B] text-[10px] font-mono uppercase tracking-wider text-zinc-500 border-b border-zinc-800/90 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3.5 w-9">
                        <input
                          type="checkbox"
                          checked={
                            filteredUsers.length > 0 &&
                            selectedUserIds.size === filteredUsers.length
                          }
                          onChange={toggleSelectAllUsers}
                          className="rounded border-zinc-700 bg-zinc-900"
                        />
                      </th>
                      <th className="py-2.5 px-3.5">User / Email</th>
                      <th className="py-2.5 px-3.5">User ID (64-Bit)</th>
                      <th className="py-2.5 px-3.5">Status</th>
                      <th className="py-2.5 px-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {usersLoading ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-16 text-center text-xs text-zinc-400"
                        >
                          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-400" />
                          Fetching users from Catalyst project...
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-14 text-center text-xs text-zinc-500"
                        >
                          No users found on this page. Click Sync Project Users to refresh.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => {
                        const uid = String(
                          user.user_id || user.zuid || user.id || ""
                        );
                        const email = user.email_id || user.email || "No email";
                        const fullName = `${user.first_name || ""} ${
                          user.last_name || ""
                        }`.trim();
                        const isChecked = selectedUserIds.has(uid);
                        const isDeleting = deletingIds.has(uid);
                        const isConfirmed =
                          user.is_confirmed === true ||
                          String(user.status || "").toUpperCase() === "ACTIVE";

                        return (
                          <tr
                            key={uid || email}
                            className="hover:bg-zinc-900/40 transition-colors"
                          >
                            <td className="py-2.5 px-3.5">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setSelectedUserIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(uid)) next.delete(uid);
                                    else next.add(uid);
                                    return next;
                                  });
                                }}
                                className="rounded border-zinc-700 bg-zinc-900"
                              />
                            </td>
                            <td className="py-2.5 px-3.5">
                              <p className="font-mono text-xs text-zinc-100 font-medium">
                                {email}
                              </p>
                              {fullName && (
                                <p className="text-[11px] text-zinc-500">
                                  {fullName}
                                </p>
                              )}
                            </td>
                            <td className="py-2.5 px-3.5 font-mono text-zinc-400">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(uid);
                                    setCopiedId(uid);
                                    setTimeout(() => setCopiedId(null), 1500);
                                  } catch {
                                    // ignore
                                  }
                                }}
                                className="inline-flex items-center gap-1.5 hover:text-zinc-200 transition"
                                title="Copy 64-bit User ID"
                              >
                                <span>{uid}</span>
                                {copiedId === uid ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 text-zinc-600" />
                                )}
                              </button>
                            </td>
                            <td className="py-2.5 px-3.5">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono uppercase border ${
                                  isConfirmed
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                    : "bg-zinc-900 text-zinc-400 border-zinc-800"
                                }`}
                              >
                                {user.status || (isConfirmed ? "CONFIRMED" : "PENDING")}
                              </span>
                            </td>
                            <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInspectedLog({
                                      identifier: email,
                                      time: user.created_time || "",
                                      payload: user,
                                    })
                                  }
                                  className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-blue-400 transition"
                                  title="Inspect user JSON"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => handleDeleteSingleUser(uid)}
                                  className="p-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-400 disabled:opacity-50 transition"
                                  title="Delete user"
                                >
                                  {isDeleting ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Modals */}
      <ProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        profiles={profiles}
        initialProfile={profileToEdit}
        onSaveProfile={handleSaveProfile}
        onDeleteProfile={handleDeleteProfile}
        showToast={showToast}
      />

      <HtmlPreviewModal
        open={htmlPreviewOpen}
        onClose={() => setHtmlPreviewOpen(false)}
        subject={emailSubject}
        fromEmail={emailFromOverride.trim() || activeProfile?.fromEmail || ""}
        displayName={emailDisplayName}
        htmlContent={emailContent}
      />

      <PayloadModal item={inspectedLog} onClose={() => setInspectedLog(null)} />
    </div>
  );
}
