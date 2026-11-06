"use client";

import { useState } from "react";
import { Check, Copy, FileJson, X } from "lucide-react";

export default function PayloadModal({ item, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  const formattedJson = JSON.stringify(item.payload ?? {}, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        className="panel-surface w-full max-w-2xl rounded-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/90 bg-zinc-950/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <FileJson className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-100 truncate">
                Diagnostic Payload Inspector
              </h3>
              <p className="text-[11px] font-mono text-zinc-400 truncate">
                {item.identifier || "API Response"} {item.time ? `• ${item.time}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[#09090B]">
          <pre className="p-4 rounded-md bg-[#0C0C0F] border border-zinc-800/90 text-xs font-mono leading-relaxed text-emerald-300/95 max-h-[440px] overflow-auto">
            {formattedJson}
          </pre>
        </div>
      </div>
    </div>
  );
}
