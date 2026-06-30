/**
 * useUpdater — Electron otomatik güncelleme köprüsünü (preload'daki
 * window.hareketDesktop) saran React hook'u. Web/tarayıcıda güvenle no-op döner
 * (isElectron=false), böylece aynı kod hem web hem masaüstünde çalışır.
 */
import { useCallback, useEffect, useState } from "react";

declare global {
  interface Window {
    hareketDesktop?: {
      isElectron: boolean;
      getVersion: () => Promise<string>;
      checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
      downloadUpdate: () => Promise<{ ok: boolean }>;
      installUpdate: () => Promise<{ ok: boolean }>;
      on: (channel: string, cb: (data: unknown) => void) => () => void;
    };
  }
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export interface UpdaterState {
  isElectron: boolean;
  status: UpdateStatus;
  version: string; // mevcut uygulama sürümü
  newVersion: string; // bulunan güncelleme sürümü
  progress: number; // indirme yüzdesi (0-100)
  error: string;
  dismissed: boolean;
  check: () => void;
  download: () => void;
  install: () => void;
  dismiss: () => void;
}

export function useUpdater(): UpdaterState {
  const api = typeof window !== "undefined" ? window.hareketDesktop : undefined;
  const isElectron = !!api?.isElectron;

  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!api) return;
    api.getVersion().then(setVersion).catch(() => {});
    const offs = [
      api.on("updater:checking", () => {
        setStatus("checking");
        setError("");
        setDismissed(false);
      }),
      api.on("updater:available", (d) => {
        setStatus("available");
        setNewVersion((d as { version?: string })?.version ?? "");
        setDismissed(false);
      }),
      api.on("updater:not-available", () => setStatus("not-available")),
      api.on("updater:progress", (d) => {
        setStatus("downloading");
        setProgress((d as { percent?: number })?.percent ?? 0);
      }),
      api.on("updater:downloaded", (d) => {
        setStatus("downloaded");
        setNewVersion((d as { version?: string })?.version ?? newVersion);
      }),
      api.on("updater:error", (d) => {
        setStatus("error");
        setError((d as { message?: string })?.message ?? "Güncelleme hatası");
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = useCallback(() => {
    if (!api) return;
    setDismissed(false);
    setStatus("checking");
    api.checkForUpdates().catch(() => {});
  }, [api]);

  const download = useCallback(() => {
    if (!api) return;
    setStatus("downloading");
    setProgress(0);
    api.downloadUpdate().catch(() => {});
  }, [api]);

  const install = useCallback(() => {
    api?.installUpdate().catch(() => {});
  }, [api]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    isElectron,
    status,
    version,
    newVersion,
    progress,
    error,
    dismissed,
    check,
    download,
    install,
    dismiss,
  };
}
