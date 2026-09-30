/**
 * useUpdater — Electron otomatik güncelleme köprüsünü (preload'daki
 * window.hareketDesktop) saran React hook'u. Web/tarayıcıda güvenle no-op döner
 * (isElectron=false), böylece aynı kod hem web hem masaüstünde çalışır.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { tStatic } from "./i18n";

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
  // Kullanıcı elle denetlediyse "güncel" / hata bildirimi gösterilir; otomatik
  // (açılış + 4 saatlik) denetimlerde yalnızca güncelleme bulununca konuşulur.
  const manual = useRef(false);

  useEffect(() => {
    if (!api) return;
    api.getVersion().then(setVersion).catch(() => {});
    const offs = [
      api.on("updater:checking", (d) => {
        if ((d as { manual?: boolean } | undefined)?.manual) manual.current = true;
        setStatus((s) => (s === "downloading" || s === "downloaded" ? s : "checking"));
        setError("");
      }),
      api.on("updater:available", (d) => {
        setStatus("available");
        setNewVersion((d as { version?: string })?.version ?? "");
        setDismissed(false);
      }),
      api.on("updater:not-available", () => {
        setStatus(manual.current ? "not-available" : "idle");
        if (manual.current) setDismissed(false);
        manual.current = false;
      }),
      api.on("updater:progress", (d) => {
        setStatus("downloading");
        setProgress((d as { percent?: number })?.percent ?? 0);
      }),
      api.on("updater:downloaded", (d) => {
        setStatus("downloaded");
        setDismissed(false);
        setNewVersion((prev) => (d as { version?: string })?.version || prev);
      }),
      api.on("updater:error", (d) => {
        // Otomatik denetimde (ör. çevrimdışı) kullanıcıyı rahatsız etme.
        if (!manual.current) {
          setStatus((s) => (s === "downloaded" ? s : "idle"));
          return;
        }
        manual.current = false;
        setStatus("error");
        setDismissed(false);
        setError((d as { message?: string })?.message ?? tStatic("Güncelleme hatası"));
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = useCallback(() => {
    if (!api) return;
    manual.current = true;
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
