"use client";

import { useState } from "react";
import { ExternalLink, Eye, Monitor, Smartphone, X } from "lucide-react";

export default function HtmlPreviewModal({
  open,
  onClose,
  subject,
  fromEmail,
  displayName,
  htmlContent,
}) {
  const [viewport, setViewport] = useState("desktop");

  if (!open) return null;

  const renderedBody =
    htmlContent && htmlContent.trim()
      ? htmlContent
      : '<div style="padding:32px;text-align:center;color:#71717a;font-family:system-ui,sans-serif;font-size:14px;">No HTML content entered yet.</div>';

  const srcDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      margin: 0;
      padding: 24px;
      background: #ffffff;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
    }
  </style>
</head>
<body>${renderedBody}</body>
</html>`;

  const openExternalWindow = () => {
    const win = window.open("", "_blank", "width=760,height=640");
    if (win) {
      win.document.write(srcDoc);
      win.document.close();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 dark:bg-black/80 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="panel-surface w-full max-w-4xl rounded-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/90 bg-zinc-50 dark:bg-zinc-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                HTML Email Render Preview
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Sandboxed client viewport simulation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md bg-zinc-200/70 dark:bg-zinc-900 p-0.5 border border-zinc-300 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setViewport("desktop")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${
                  viewport === "desktop"
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport("mobile")}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition ${
                  viewport === "mobile"
                    ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm"
                    : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Mobile (375px)
              </button>
            </div>

            <button
              type="button"
              onClick={openExternalWindow}
              title="Pop out preview"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-800 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Pop Out
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800/70 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Simulated Email Header */}
        <div className="px-5 py-3 bg-zinc-100/80 dark:bg-[#0C0C10] border-b border-zinc-200 dark:border-zinc-800/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="truncate">
            <span className="text-zinc-500 font-medium mr-2">From:</span>
            <span className="text-zinc-800 dark:text-zinc-200 font-mono">
              {displayName ? `${displayName} ` : ""}
              &lt;{fromEmail || "sender@yourdomain.com"}&gt;
            </span>
          </div>
          <div className="truncate">
            <span className="text-zinc-500 font-medium mr-2">Subject:</span>
            <span className="text-zinc-900 dark:text-zinc-100 font-medium">
              {subject || "(No subject line)"}
            </span>
          </div>
        </div>

        {/* Sandboxed Canvas */}
        <div className="p-6 bg-[#F4F5F7] dark:bg-[#09090B] flex justify-center overflow-auto max-h-[68vh]">
          <div
            className={`bg-white rounded-md overflow-hidden shadow-xl border border-zinc-300 dark:border-zinc-700 transition-all duration-200 ${
              viewport === "mobile" ? "w-[375px]" : "w-full"
            }`}
          >
            <iframe
              title="Email HTML Preview"
              sandbox=""
              srcDoc={srcDoc}
              className="w-full h-[440px] border-0 bg-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
