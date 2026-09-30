/**
 * ProjectHome.tsx — uygulama açılışındaki tam ekran "Projeler" başlangıç sayfası
 * (CAD programlarının başlangıç ekranı gibi). Proje kütüphanesini (klasörler +
 * projeler + son açılanlar) projectStore üzerinden yönetir; proje açma/oluşturma
 * kararını üst bileşene (App) callback'lerle bildirir.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CraneModel } from "../engine/types";
import { useI18n, type TFn } from "./i18n";
import {
  addRecent,
  getProjectStore,
  listRecent,
  removeRecent,
  updateRecentId,
  type ExternalFile,
  type ProjectEntry,
  type ProjectListing,
  type RecentEntry,
} from "./projectStore";
import logoW from "../assets/brand/logo_w.png";

export interface ProjectHomeProps {
  cranes: CraneModel[];
  appVersion?: string;
  hasAutosave: boolean;
  onContinue: () => void;
  onNew: (p: {
    name: string;
    folder: string;
    craneModel: string;
    meta: { projectName: string; siteLocation: string; client: string };
  }) => void;
  onOpen: (
    p:
      | { source: "library"; entry: ProjectEntry; content: string }
      | { source: "external"; file: ExternalFile }
      | { source: "upload"; name: string; content: string },
  ) => void;
}

type View = { kind: "recent" } | { kind: "all" } | { kind: "folder"; path: string };
type Layout = "grid" | "list";
type Sort = "updated" | "name";

const PREF_KEY = "hareket_home_prefs";

function readPrefs(): { layout: Layout; sort: Sort } {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { layout?: string; sort?: string };
      return { layout: p.layout === "list" ? "list" : "grid", sort: p.sort === "name" ? "name" : "updated" };
    }
  } catch {
    /* yok say */
  }
  return { layout: "grid", sort: "updated" };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function baseName(folder: string): string {
  const i = folder.lastIndexOf("/");
  return i >= 0 ? folder.slice(i + 1) : folder;
}

function parentOf(folder: string): string {
  const i = folder.lastIndexOf("/");
  return i >= 0 ? folder.slice(0, i) : "";
}

function isInside(f: string, folder: string): boolean {
  return f === folder || f.startsWith(folder + "/");
}

function relTime(iso: string, t: TFn, lang: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (!isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("az önce");
  const m = Math.round(s / 60);
  if (m < 60) return t("{n} dk önce", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} saat önce", { n: h });
  const days = Math.round(h / 24);
  if (days < 30) return t("{n} gün önce", { n: days });
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "tr-TR");
}

/** Enter → onConfirm, Escape → onCancel. */
function InlineInput({
  initial,
  label,
  placeholder,
  onConfirm,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder?: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [v, setV] = useState(initial);
  return (
    <span className="ph-inline" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        aria-label={label}
        autoFocus
        value={v}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (v.trim()) onConfirm(v.trim());
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <button type="button" className="ph-mini ok" title={t("Onayla")} aria-label={t("Onayla")} disabled={!v.trim()} onClick={() => onConfirm(v.trim())}>
        ✓
      </button>
      <button type="button" className="ph-mini" title={t("Vazgeç")} aria-label={t("Vazgeç")} onClick={onCancel}>
        ✕
      </button>
    </span>
  );
}

export default function ProjectHome({ cranes, appVersion, hasAutosave, onContinue, onNew, onOpen }: ProjectHomeProps) {
  const { t, lang } = useI18n();
  const store = useMemo(() => getProjectStore(), []);
  const isDesktop = store.kind === "fs";

  const [listing, setListing] = useState<ProjectListing | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => listRecent());
  const [rootLabel, setRootLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [view, setView] = useState<View>(() => (listRecent().length ? { kind: "recent" } : { kind: "all" }));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState<Layout>(() => readPrefs().layout);
  const [sort, setSort] = useState<Sort>(() => readPrefs().sort);

  // Klasör işlemleri
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null); // üst klasör ("" = kök)
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [folderRename, setFolderRename] = useState<string | null>(null);
  const [folderDelete, setFolderDelete] = useState<string | null>(null);

  // Proje işlemleri
  const [projRename, setProjRename] = useState<string | null>(null);
  const [projMove, setProjMove] = useState<string | null>(null);
  const [projDelete, setProjDelete] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ layout, sort }));
    } catch {
      /* yok say */
    }
  }, [layout, sort]);

  const reload = useCallback(async () => {
    try {
      const l = await store.list();
      setListing(l);
      setRecent(listRecent());
    } catch (e) {
      setError(t("Proje listesi okunamadı: {msg}", { msg: errMsg(e) }));
      setListing((prev) => prev ?? { projects: [], folders: [] });
    }
  }, [store, t]);

  useEffect(() => {
    void reload();
    store
      .rootLabel()
      .then(setRootLabel)
      .catch(() => setRootLabel(""));
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Store işlemini çalıştır: hata → error-box, ardından listeyi yenile. */
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(t("İşlem başarısız: {msg}", { msg: errMsg(e) }));
        return undefined;
      } finally {
        await reload();
        setBusy(false);
      }
    },
    [reload, t],
  );

  // Ctrl+N → yeni proje
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowNew(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Türetilmiş veriler ─────────────────────────────────────────────────────
  const projects = listing?.projects ?? [];

  const folders = useMemo(() => {
    const set = new Set<string>();
    const add = (f: string) => {
      const parts = f.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
    };
    for (const f of listing?.folders ?? []) add(f);
    for (const p of projects) if (p.folder) add(p.folder);
    return [...set].sort((a, b) => a.localeCompare(b, "tr"));
  }, [listing, projects]);

  const children = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const f of folders) {
      const p = parentOf(f);
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(f);
    }
    return m;
  }, [folders]);

  const countIn = useCallback(
    (folder: string) => projects.filter((p) => isInside(p.folder, folder)).length,
    [projects],
  );

  const selectedFolder = view.kind === "folder" ? view.path : "";

  const q = search.trim().toLocaleLowerCase("tr");
  const matches = useCallback(
    (p: { name: string; projectName?: string | null; siteLocation?: string | null; craneModel?: string | null }) => {
      if (!q) return true;
      return [p.name, p.projectName, p.siteLocation, p.craneModel].some((s) => s && s.toLocaleLowerCase("tr").includes(q));
    },
    [q],
  );

  const shownProjects = useMemo(() => {
    let list = projects;
    if (view.kind === "folder") list = list.filter((p) => p.folder === view.path);
    list = list.filter(matches);
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    else sorted.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return sorted;
  }, [projects, view, matches, sort]);

  const shownRecent = useMemo(
    () =>
      recent
        .map((r) => ({ r, entry: r.kind === "library" ? projects.find((p) => p.id === r.id) ?? null : null }))
        .filter(({ r, entry }) => matches(entry ?? { name: r.name, craneModel: r.craneModel })),
    [recent, projects, matches],
  );

  // ── Eylemler ───────────────────────────────────────────────────────────────
  const openEntry = async (entry: ProjectEntry) => {
    setError(null);
    setBusy(true);
    try {
      const content = await store.read(entry.id);
      setRecent(addRecent({ kind: "library", id: entry.id, name: entry.name, craneModel: entry.craneModel }));
      onOpen({ source: "library", entry, content });
    } catch (e) {
      setError(t("Proje açılamadı: {msg}", { msg: errMsg(e) }));
      void reload();
    } finally {
      setBusy(false);
    }
  };

  const openFile = async () => {
    setError(null);
    if (store.openDialog) {
      try {
        const file = await store.openDialog();
        if (!file) return;
        setRecent(addRecent({ kind: "external", id: file.path, name: file.name }));
        onOpen({ source: "external", file });
      } catch (e) {
        setError(t("Dosya açılamadı: {msg}", { msg: errMsg(e) }));
      }
    } else {
      uploadRef.current?.click();
    }
  };

  const renameProject = (p: ProjectEntry, name: string) => {
    setProjRename(null);
    if (name === p.name) return;
    void run(async () => {
      const e = await store.rename(p.id, name);
      updateRecentId(p.id, e);
    });
  };

  const moveProject = (p: ProjectEntry, folder: string) => {
    setProjMove(null);
    if (folder === p.folder) return;
    void run(async () => {
      const e = await store.move(p.id, folder);
      updateRecentId(p.id, e);
    });
  };

  const duplicateProject = (p: ProjectEntry) => void run(() => store.duplicate(p.id));

  const deleteProject = (p: ProjectEntry) => {
    setProjDelete(null);
    void run(async () => {
      await store.remove(p.id);
      removeRecent("library", p.id);
    });
  };

  const revealProject = (p: ProjectEntry) => {
    if (!store.reveal) return;
    store.reveal(p.id).catch((e) => setError(t("İşlem başarısız: {msg}", { msg: errMsg(e) })));
  };

  const createFolder = (parent: string, name: string) => {
    setNewFolderIn(null);
    void run(async () => {
      const f = await store.createFolder(parent ? `${parent}/${name}` : name);
      if (parent) setExpanded((s) => new Set(s).add(parent));
      if (f) setView({ kind: "folder", path: f });
    });
  };

  const renameFolder = (folder: string, name: string) => {
    setFolderRename(null);
    setFolderMenu(null);
    if (name === baseName(folder)) return;
    const before = projects.filter((p) => isInside(p.folder, folder));
    void run(async () => {
      const next = await store.renameFolder(folder, name);
      // Masaüstünde id = yol → içerdeki projelerin son açılan kayıtlarını güncelle.
      const l = await store.list();
      for (const p of before) {
        const nf = next + p.folder.slice(folder.length);
        const e = l.projects.find((x) => x.folder === nf && x.name === p.name);
        if (e && e.id !== p.id) updateRecentId(p.id, e);
      }
      setExpanded((s) => {
        const n = new Set<string>();
        for (const f of s) n.add(isInside(f, folder) ? next + f.slice(folder.length) : f);
        return n;
      });
      setView((v) => (v.kind === "folder" && isInside(v.path, folder) ? { kind: "folder", path: next + v.path.slice(folder.length) } : v));
    });
  };

  const deleteFolder = (folder: string) => {
    setFolderDelete(null);
    setFolderMenu(null);
    const inside = projects.filter((p) => isInside(p.folder, folder));
    void run(async () => {
      await store.removeFolder(folder);
      for (const p of inside) removeRecent("library", p.id);
      setView((v) => (v.kind === "folder" && isInside(v.path, folder) ? { kind: "all" } : v));
    });
  };

  const toggleExpand = (f: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  // ── Sol panel: klasör ağacı ─────────────────────────────────────────────────
  const renderFolder = (f: string, depth: number): ReactNode => {
    const kids = children.get(f) ?? [];
    const open = expanded.has(f);
    const active = view.kind === "folder" && view.path === f;
    const n = countIn(f);
    return (
      <li key={f}>
        <div className={"ph-tree-row" + (active ? " active" : "")} style={{ paddingLeft: 6 + depth * 14 }}>
          <button
            type="button"
            className="ph-chev"
            aria-label={open ? t("Daralt") : t("Genişlet")}
            style={{ visibility: kids.length ? "visible" : "hidden" }}
            onClick={() => toggleExpand(f)}
          >
            {open ? "▾" : "▸"}
          </button>
          {folderRename === f ? (
            <InlineInput
              initial={baseName(f)}
              label={t("Klasör adı")}
              onConfirm={(v) => renameFolder(f, v)}
              onCancel={() => setFolderRename(null)}
            />
          ) : (
            <>
              <button
                type="button"
                className="ph-tree-name"
                title={f}
                onClick={() => {
                  setView({ kind: "folder", path: f });
                  if (kids.length && !open) toggleExpand(f);
                }}
              >
                <span aria-hidden>📁</span> {baseName(f)}
              </button>
              <span className="ph-count">{n}</span>
              <button
                type="button"
                className="ph-mini"
                aria-label={t("Klasör işlemleri")}
                title={t("Klasör işlemleri")}
                onClick={() => {
                  setFolderMenu(folderMenu === f ? null : f);
                  setFolderDelete(null);
                }}
              >
                ⋯
              </button>
            </>
          )}
        </div>
        {folderMenu === f && folderRename !== f && (
          <div className="ph-folder-menu" style={{ marginLeft: 20 + depth * 14 }}>
            {folderDelete === f ? (
              <div className="ph-confirm">
                <div>
                  {n > 0
                    ? t("\"{name}\" klasörü ve içindeki {n} proje silinsin mi?", { name: baseName(f), n })
                    : t("\"{name}\" klasörü silinsin mi?", { name: baseName(f) })}
                </div>
                {isDesktop && <div className="ph-note">{t("Klasör ve içindekiler Geri Dönüşüm Kutusu'na taşınır.")}</div>}
                {!isDesktop && n > 0 && <div className="ph-note">{t("Bu işlem geri alınamaz.")}</div>}
                <div className="ph-row">
                  <button type="button" className="btn danger" disabled={busy} onClick={() => deleteFolder(f)}>
                    {t("Sil")}
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setFolderDelete(null)}>
                    {t("Vazgeç")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ph-row wrap">
                <button type="button" className="ph-link" onClick={() => setFolderRename(f)}>
                  {t("Yeniden adlandır")}
                </button>
                <button
                  type="button"
                  className="ph-link"
                  onClick={() => {
                    setNewFolderIn(f);
                    setExpanded((s) => new Set(s).add(f));
                    setFolderMenu(null);
                  }}
                >
                  {t("Alt klasör")}
                </button>
                <button type="button" className="ph-link danger" onClick={() => setFolderDelete(f)}>
                  {t("Sil")}
                </button>
              </div>
            )}
          </div>
        )}
        {newFolderIn === f && (
          <div className="ph-tree-row" style={{ paddingLeft: 26 + depth * 14 }}>
            <InlineInput
              initial=""
              label={t("Yeni klasör adı")}
              placeholder={t("Klasör adı")}
              onConfirm={(v) => createFolder(f, v)}
              onCancel={() => setNewFolderIn(null)}
            />
          </div>
        )}
        {open && kids.length > 0 && <ul className="ph-tree">{kids.map((k) => renderFolder(k, depth + 1))}</ul>}
      </li>
    );
  };

  // ── Proje kartı / satırı ────────────────────────────────────────────────────
  const craneKnown = (m: string | null) => !!m && cranes.some((c) => c.model === m);

  const renderActions = (p: ProjectEntry) => {
    if (projDelete === p.id) {
      return (
        <div className="ph-confirm" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <div>{t("\"{name}\" silinsin mi?", { name: p.name })}</div>
          <div className="ph-note">{isDesktop ? t("Geri Dönüşüm Kutusu'na taşınır.") : t("Bu işlem geri alınamaz.")}</div>
          <div className="ph-row">
            <button type="button" className="btn danger" disabled={busy} onClick={() => deleteProject(p)}>
              {t("Sil")}
            </button>
            <button type="button" className="btn ghost" onClick={() => setProjDelete(null)}>
              {t("Vazgeç")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="ph-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="ph-act primary" disabled={busy} onClick={() => void openEntry(p)}>
          {t("Aç")}
        </button>
        <button type="button" className="ph-act" onClick={() => setProjRename(p.id)}>
          {t("Yeniden adlandır")}
        </button>
        <span className="ph-pop-anchor">
          <button type="button" className="ph-act" aria-expanded={projMove === p.id} onClick={() => setProjMove(projMove === p.id ? null : p.id)}>
            {t("Taşı")}
          </button>
          {projMove === p.id && (
            <>
              <div className="ph-backdrop" onClick={() => setProjMove(null)} />
              <div className="ph-popover" role="menu" aria-label={t("Hedef klasör")}>
                <div className="ph-pop-title">{t("Hedef klasör")}</div>
                {["", ...folders].map((f) => (
                  <button
                    key={f || "__root"}
                    type="button"
                    role="menuitem"
                    className={"ph-pop-item" + (f === p.folder ? " current" : "")}
                    disabled={f === p.folder || busy}
                    style={{ paddingLeft: 10 + (f ? f.split("/").length - 1 : 0) * 12 }}
                    onClick={() => moveProject(p, f)}
                  >
                    {f ? `📁 ${baseName(f)}` : `⌂ ${t("Kök klasör")}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </span>
        <button type="button" className="ph-act" disabled={busy} onClick={() => duplicateProject(p)}>
          {t("Çoğalt")}
        </button>
        {isDesktop && store.reveal && (
          <button type="button" className="ph-act" onClick={() => revealProject(p)}>
            {t("Gezgin'de göster")}
          </button>
        )}
        <button type="button" className="ph-act danger" onClick={() => setProjDelete(p.id)}>
          {t("Sil")}
        </button>
      </div>
    );
  };

  const renderProject = (p: ProjectEntry) => {
    const sub = [p.projectName, p.siteLocation].filter(Boolean).join(" · ");
    const nameEl =
      projRename === p.id ? (
        <InlineInput initial={p.name} label={t("Proje adı")} onConfirm={(v) => renameProject(p, v)} onCancel={() => setProjRename(null)} />
      ) : (
        <span className="ph-name" title={p.name}>
          {p.name}
        </span>
      );
    const crane = p.craneModel ? (
      <span className={"ph-pill" + (craneKnown(p.craneModel) ? "" : " unknown")} title={craneKnown(p.craneModel) ? p.craneModel : t("Bu vinç modeli listede yok")}>
        {p.craneModel}
      </span>
    ) : null;
    const folderEl = (
      <span className="ph-folder" title={p.folder || t("Kök klasör")}>
        📁 {p.folder || t("Kök")}
      </span>
    );
    const time = (
      <span className="ph-time" title={new Date(p.updatedAt).toLocaleString(lang === "en" ? "en-GB" : "tr-TR")}>
        {relTime(p.updatedAt, t, lang)}
      </span>
    );
    if (layout === "list") {
      return (
        <div key={p.id} className="ph-rowitem" onDoubleClick={() => void openEntry(p)}>
          <div className="ph-col-main">
            {nameEl}
            {sub && <span className="ph-sub">{sub}</span>}
          </div>
          <div className="ph-col-crane">{crane}</div>
          <div className="ph-col-folder">{view.kind !== "folder" && folderEl}</div>
          <div className="ph-col-time">{time}</div>
          <div className="ph-col-actions">{renderActions(p)}</div>
        </div>
      );
    }
    return (
      <div key={p.id} className="ph-card" onDoubleClick={() => void openEntry(p)}>
        <div className="ph-card-head">
          <span className="ph-card-icon" aria-hidden>
            🏗
          </span>
          <div className="ph-card-title">
            {nameEl}
            <span className="ph-sub">{sub || t("Proje bilgisi girilmemiş")}</span>
          </div>
        </div>
        <div className="ph-meta">
          {crane}
          {folderEl}
          <span className="ph-spacer" />
          {time}
        </div>
        {renderActions(p)}
      </div>
    );
  };

  const renderRecent = ({ r, entry }: { r: RecentEntry; entry: ProjectEntry | null }) => {
    if (entry) return renderProject(entry);
    const external = r.kind === "external";
    return (
      <div key={r.kind + r.id} className={layout === "list" ? "ph-rowitem dim" : "ph-card dim"}>
        <div className="ph-card-head">
          <span className="ph-card-icon" aria-hidden>
            {external ? "📄" : "⚠"}
          </span>
          <div className="ph-card-title">
            <span className="ph-name">{r.name}</span>
            <span className="ph-sub" title={external ? r.id : undefined}>
              {external ? r.id : t("Proje bulunamadı (silinmiş veya taşınmış olabilir).")}
            </span>
          </div>
        </div>
        <div className="ph-meta">
          {r.craneModel && <span className="ph-pill">{r.craneModel}</span>}
          <span className="ph-spacer" />
          <span className="ph-time">{relTime(r.openedAt, t, lang)}</span>
        </div>
        {external && <div className="ph-note">{t("Güvenlik nedeniyle harici dosyalar doğrudan açılamaz — dosyayı yeniden seçin.")}</div>}
        <div className="ph-actions">
          {external && store.openDialog && (
            <button type="button" className="ph-act primary" onClick={() => void openFile()}>
              {t("Dosyayı yeniden seçin")}
            </button>
          )}
          <button type="button" className="ph-act" onClick={() => setRecent(removeRecent(r.kind, r.id))}>
            {t("Listeden kaldır")}
          </button>
        </div>
      </div>
    );
  };

  // ── Başlık / boş durum ─────────────────────────────────────────────────────
  const title = view.kind === "recent" ? t("Son Projeler") : view.kind === "all" ? t("Tüm Projeler") : baseName(view.path);
  const subFolders = view.kind === "folder" ? children.get(view.path) ?? [] : [];

  let empty: string | null = null;
  if (listing) {
    if (view.kind === "recent" && shownRecent.length === 0)
      empty = q ? t("\"{q}\" için sonuç bulunamadı.", { q: search.trim() }) : t("Son açılan proje yok. Bir proje açtığınızda burada görünür.");
    else if (view.kind !== "recent" && shownProjects.length === 0) {
      if (q) empty = t("\"{q}\" için sonuç bulunamadı.", { q: search.trim() });
      else if (projects.length === 0) empty = t("Henüz proje yok — Yeni Proje ile başlayın.");
      else if (view.kind === "folder") empty = t("Bu klasörde proje yok. Yeni Proje ile bu klasöre proje ekleyin.");
    }
  }

  return (
    <div className="ph">
      <style>{CSS}</style>
      <input
        ref={uploadRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const content = await f.text();
            onOpen({ source: "upload", name: f.name.replace(/(\.hcp)?\.json$/i, ""), content });
          } catch (err) {
            setError(t("Dosya açılamadı: {msg}", { msg: errMsg(err) }));
          }
        }}
      />

      {/* Üst çubuk */}
      <header className="ph-top">
        <img className="ph-logo" src={logoW} alt="Hareket" />
        <span className="ph-brand">Crane Planner</span>
        {appVersion && <span className="ph-ver">v{appVersion}</span>}
        <span className="ph-top-sep" />
        <span className="ph-top-sub">{t("Projeler")}</span>
      </header>

      <div className="ph-body">
        {/* Sol panel */}
        <aside className="ph-side">
          <nav className="ph-nav" aria-label={t("Projeler")}>
            <button type="button" className={"ph-nav-item" + (view.kind === "recent" ? " active" : "")} onClick={() => setView({ kind: "recent" })}>
              <span aria-hidden>🕘</span> {t("Son Projeler")}
              <span className="ph-count">{recent.length}</span>
            </button>
            <button type="button" className={"ph-nav-item" + (view.kind === "all" ? " active" : "")} onClick={() => setView({ kind: "all" })}>
              <span aria-hidden>🗂</span> {t("Tüm Projeler")}
              <span className="ph-count">{projects.length}</span>
            </button>
          </nav>

          <div className="ph-side-head">
            <span>{t("Klasörler")}</span>
            <button type="button" className="ph-link" onClick={() => setNewFolderIn(selectedFolder)} title={selectedFolder ? t("\"{name}\" içinde", { name: baseName(selectedFolder) }) : undefined}>
              + {t("Yeni klasör")}
            </button>
          </div>
          {newFolderIn === "" && (
            <div className="ph-tree-row" style={{ paddingLeft: 6 }}>
              <InlineInput
                initial=""
                label={t("Yeni klasör adı")}
                placeholder={t("Klasör adı")}
                onConfirm={(v) => createFolder("", v)}
                onCancel={() => setNewFolderIn(null)}
              />
            </div>
          )}
          <ul className="ph-tree root">
            <li>
              <div className={"ph-tree-row" + (view.kind === "folder" && view.path === "" ? " active" : "")} style={{ paddingLeft: 6 }}>
                <span className="ph-chev" aria-hidden style={{ visibility: "hidden" }}>
                  ▸
                </span>
                <button type="button" className="ph-tree-name" onClick={() => setView({ kind: "folder", path: "" })}>
                  <span aria-hidden>⌂</span> {t("Kök klasör")}
                </button>
                <span className="ph-count">{projects.filter((p) => !p.folder).length}</span>
              </div>
            </li>
            {(children.get("") ?? []).map((f) => renderFolder(f, 0))}
          </ul>
          {folders.length === 0 && listing && <div className="ph-hint">{t("Projeleri düzenlemek için klasör oluşturun.")}</div>}

          <div className="ph-side-foot">
            <div className="ph-foot-label">{t("Depolama konumu")}</div>
            <div className="ph-foot-path" title={rootLabel}>
              {rootLabel || "—"}
            </div>
            {isDesktop && store.reveal && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => store.reveal!().catch((e) => setError(t("İşlem başarısız: {msg}", { msg: errMsg(e) })))}
              >
                {t("Klasörü Gezgin'de aç")}
              </button>
            )}
          </div>
        </aside>

        {/* Ana alan */}
        <main className="ph-main">
          <div className="ph-main-head">
            <h2 className="ph-title">
              {view.kind === "folder" && view.path === "" ? t("Kök klasör") : title}
              {view.kind === "folder" && view.path.includes("/") && <span className="ph-crumb">{parentOf(view.path)} /</span>}
            </h2>
            <span className="ph-spacer" />
            <input
              type="search"
              className="ph-search"
              aria-label={t("Projelerde ara")}
              placeholder={t("Ara: ad, proje, saha, vinç…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch("");
              }}
            />
            <div className="seg" role="group" aria-label={t("Görünüm")}>
              <button type="button" className={"seg-btn" + (layout === "grid" ? " active" : "")} aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>
                ▦ {t("Kart")}
              </button>
              <button type="button" className={"seg-btn" + (layout === "list" ? " active" : "")} aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
                ☰ {t("Liste")}
              </button>
            </div>
            <label className="ph-sort">
              <span>{t("Sırala")}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="updated">{t("Son değişiklik")}</option>
                <option value="name">{t("Ad")}</option>
              </select>
            </label>
          </div>

          <div className="ph-action-row">
            <button type="button" className="btn primary ph-big" onClick={() => setShowNew(true)} title="Ctrl+N">
              <span className="ph-big-icon">＋</span>
              <span>
                <b>{t("Yeni Proje")}</b>
                <small>{t("Boş bir kaldırma planı başlat")}</small>
              </span>
            </button>
            <button type="button" className="btn ghost ph-big" onClick={() => void openFile()}>
              <span className="ph-big-icon">📂</span>
              <span>
                <b>{t("Proje Aç…")}</b>
                <small>{isDesktop ? t("Bilgisayardan .json proje dosyası seç") : t("Bilgisayardan .json proje dosyası yükle")}</small>
              </span>
            </button>
            {hasAutosave && (
              <button type="button" className="btn ghost ph-big" onClick={onContinue}>
                <span className="ph-big-icon">↺</span>
                <span>
                  <b>{t("Son oturuma devam et")}</b>
                  <small>{t("Kaydedilmemiş son çalışmayı geri yükle")}</small>
                </span>
              </button>
            )}
          </div>

          {error && (
            <div className="error-box ph-error" role="alert">
              <span>{error}</span>
              <button type="button" className="ph-mini" aria-label={t("Kapat")} onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}

          {subFolders.length > 0 && !q && (
            <div className="ph-subfolders">
              {subFolders.map((f) => (
                <button key={f} type="button" className="ph-chip" onClick={() => setView({ kind: "folder", path: f })}>
                  📁 {baseName(f)} <span className="ph-count">{countIn(f)}</span>
                </button>
              ))}
            </div>
          )}

          {!listing ? (
            <div className="ph-empty">{t("Yükleniyor…")}</div>
          ) : empty ? (
            <div className="ph-empty">
              <div className="ph-empty-icon" aria-hidden>
                {view.kind === "recent" ? "🕘" : "🏗"}
              </div>
              <div>{empty}</div>
              {view.kind !== "recent" && !q && (
                <button type="button" className="btn primary" onClick={() => setShowNew(true)}>
                  + {t("Yeni Proje")}
                </button>
              )}
            </div>
          ) : (
            <div className={layout === "grid" ? "ph-grid" : "ph-list"}>
              {layout === "list" && (
                <div className="ph-rowitem ph-list-head" aria-hidden>
                  <div className="ph-col-main">{t("Ad")}</div>
                  <div className="ph-col-crane">{t("Vinç")}</div>
                  <div className="ph-col-folder">{view.kind !== "folder" ? t("Klasör") : ""}</div>
                  <div className="ph-col-time">{t("Değiştirilme")}</div>
                  <div className="ph-col-actions" />
                </div>
              )}
              {view.kind === "recent" ? shownRecent.map(renderRecent) : shownProjects.map(renderProject)}
            </div>
          )}
        </main>
      </div>

      {showNew && (
        <NewProjectDialog
          cranes={cranes}
          folders={folders}
          defaultFolder={selectedFolder}
          onCancel={() => setShowNew(false)}
          onCreate={(p) => {
            setShowNew(false);
            onNew(p);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yeni proje modalı
// ─────────────────────────────────────────────────────────────────────────────
function NewProjectDialog({
  cranes,
  folders,
  defaultFolder,
  onCancel,
  onCreate,
}: {
  cranes: CraneModel[];
  folders: string[];
  defaultFolder: string;
  onCancel: () => void;
  onCreate: ProjectHomeProps["onNew"];
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(defaultFolder);
  const [crane, setCrane] = useState(cranes[0]?.model ?? "");
  const [projectName, setProjectName] = useState("");
  const [siteLocation, setSiteLocation] = useState("");
  const [client, setClient] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const valid = name.trim().length > 0 && !!crane;
  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onCreate({
      name: name.trim(),
      folder,
      craneModel: crane,
      meta: { projectName: projectName.trim(), siteLocation: siteLocation.trim(), client: client.trim() },
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form
        className="modal-card card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-labelledby="ph-new-title"
      >
        <h3 id="ph-new-title">＋ {t("Yeni Proje")}</h3>
        <div className="field">
          <label htmlFor="ph-new-name">
            {t("Proje adı")} <span style={{ color: "var(--orange)" }}>*</span>
          </label>
          <input
            id="ph-new-name"
            type="text"
            autoFocus
            required
            value={name}
            placeholder={t("ör. Fabrika Çatı Montajı")}
            onChange={(e) => setName(e.target.value)}
          />
          {touched && !name.trim() && <div style={{ color: "var(--red)", fontSize: 12, marginTop: 4 }}>{t("Proje adı gerekli.")}</div>}
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="ph-new-folder">{t("Klasör")}</label>
            <select id="ph-new-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">{t("Kök klasör")}</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ph-new-crane">{t("Vinç")}</label>
            <select id="ph-new-crane" value={crane} onChange={(e) => setCrane(e.target.value)}>
              {cranes.map((c) => (
                <option key={c.model} value={c.model}>
                  {c.model}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="section-title" style={{ marginTop: 6 }}>
          {t("Proje bilgileri (isteğe bağlı)")}
        </div>
        <div className="field">
          <label htmlFor="ph-new-pn">{t("Proje Adı")}</label>
          <input id="ph-new-pn" type="text" value={projectName} placeholder={t("ör. Fabrika Çatı Vinç Montajı")} onChange={(e) => setProjectName(e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="ph-new-site">{t("Saha / Lokasyon")}</label>
            <input id="ph-new-site" type="text" value={siteLocation} placeholder={t("ör. Gebze OSB, Kocaeli")} onChange={(e) => setSiteLocation(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ph-new-client">{t("Müşteri")}</label>
            <input id="ph-new-client" type="text" value={client} placeholder={t("ör. ABC İnşaat A.Ş.")} onChange={(e) => setClient(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
          <button className="btn ghost" type="button" onClick={onCancel}>
            {t("Vazgeç")}
          </button>
          <button className="btn primary" type="submit" disabled={!valid && touched}>
            {t("Oluştur")}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stiller (theme.css değişkenlerini kullanır; .ph altında kapsüllü)
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
.ph { position: fixed; inset: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; background: var(--bg); color: var(--text); z-index: 100; }
.ph .btn { width: auto; margin: 0; padding: 8px 14px; font-size: 13px; }
.ph .btn:disabled, .ph-act:disabled, .ph-mini:disabled { opacity: .5; cursor: default; }
.ph .btn.danger { background: rgba(255,61,0,.15); color: #ffb4ab; border: 1px solid rgba(255,61,0,.55); }
.ph .btn.danger:hover { background: rgba(255,61,0,.28); }
.ph button { font-family: inherit; }
.ph-top { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 18px; background: var(--bg-2); border-bottom: 1px solid var(--border); flex: 0 0 auto; }
.ph-logo { height: 20px; width: auto; display: block; }
.ph-brand { font-weight: 700; font-size: 14px; letter-spacing: .2px; }
.ph-ver { font-family: var(--mono); font-size: 11px; color: var(--text-faint); border: 1px solid var(--border-2); border-radius: 999px; padding: 1px 8px; }
.ph-top-sep { width: 1px; height: 18px; background: var(--border-2); margin: 0 4px; }
.ph-top-sub { color: var(--text-dim); font-size: 13px; font-weight: 600; }
.ph-body { flex: 1; min-height: 0; display: flex; }
.ph-side { width: 250px; flex: 0 0 250px; display: flex; flex-direction: column; background: var(--bg-2); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px 8px 0; }
.ph-nav { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
.ph-nav-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text-dim); font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
.ph-nav-item:hover { background: var(--panel-2); color: var(--text); }
.ph-nav-item.active { background: var(--panel-2); color: var(--text); box-shadow: inset 3px 0 0 var(--orange); }
.ph-nav-item .ph-count { margin-left: auto; }
.ph-count { font-family: var(--mono); font-size: 11px; color: var(--text-faint); min-width: 18px; text-align: right; }
.ph-side-head { display: flex; align-items: center; justify-content: space-between; padding: 0 6px 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-faint); font-weight: 700; }
.ph-link { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 4px; text-transform: none; letter-spacing: 0; font-weight: 600; }
.ph-link:hover { background: var(--panel-2); }
.ph-link.danger { color: var(--red); }
.ph-tree { list-style: none; margin: 0; padding: 0; }
.ph-tree-row { display: flex; align-items: center; gap: 2px; padding: 2px 4px; border-radius: 5px; min-height: 28px; }
.ph-tree-row:hover { background: var(--panel); }
.ph-tree-row.active { background: var(--panel-2); box-shadow: inset 3px 0 0 var(--orange); }
.ph-chev { width: 18px; height: 20px; flex: 0 0 18px; border: none; background: none; color: var(--text-faint); cursor: pointer; font-size: 11px; padding: 0; }
.ph-tree-name { flex: 1; min-width: 0; text-align: left; border: none; background: none; color: var(--text); font-size: 13px; cursor: pointer; padding: 4px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-tree-row.active .ph-tree-name { font-weight: 700; }
.ph-mini { border: 1px solid transparent; background: none; color: var(--text-faint); cursor: pointer; border-radius: 4px; padding: 1px 6px; font-size: 13px; line-height: 1.3; }
.ph-mini:hover { color: var(--text); border-color: var(--border-2); background: var(--panel-2); }
.ph-mini.ok { color: var(--green); }
.ph-folder-menu { margin: 2px 4px 6px; padding: 6px 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; }
.ph-row { display: flex; gap: 6px; align-items: center; margin-top: 6px; }
.ph-row.wrap { flex-wrap: wrap; margin-top: 0; }
.ph-inline { display: flex; gap: 3px; align-items: center; flex: 1; min-width: 0; }
.ph-inline input { padding: 4px 7px; font-size: 12.5px; min-width: 0; flex: 1; font-family: var(--sans); }
.ph-hint { color: var(--text-faint); font-size: 12px; padding: 6px 10px; line-height: 1.4; }
.ph-side-foot { margin-top: auto; padding: 12px 6px 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; position: sticky; bottom: 0; background: var(--bg-2); }
.ph-foot-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-faint); font-weight: 700; }
.ph-foot-path { font-family: var(--mono); font-size: 11px; color: var(--text-dim); word-break: break-all; line-height: 1.4; }
.ph-side-foot .btn { padding: 6px 10px; font-size: 12px; }
.ph-main { flex: 1; min-width: 0; overflow-y: auto; padding: 18px 24px 32px; }
.ph-main-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.ph-title { margin: 0; font-size: 20px; font-weight: 800; display: flex; align-items: baseline; gap: 8px; flex-direction: row-reverse; }
.ph-crumb { font-size: 13px; color: var(--text-faint); font-weight: 500; }
.ph-spacer { flex: 1; }
.ph-search { width: 260px !important; font-family: var(--sans) !important; padding: 7px 10px; background: var(--bg); border: 1px solid var(--border-2); border-radius: 7px; color: var(--text); font-size: 13px; outline: none; }
.ph-search:focus { border-color: var(--accent); }
.ph .seg .seg-btn { border: none; border-right: 1px solid var(--border); background: transparent; }
.ph .seg .seg-btn:last-child { border-right: none; }
.ph .seg .seg-btn.active { background: var(--orange); }
.ph-sort { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-faint); }
.ph-sort select { width: auto; padding: 6px 8px; font-size: 12px; }
.ph-action-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.ph .ph-big { display: flex; align-items: center; gap: 12px; padding: 14px 18px; min-width: 230px; text-align: left; border-radius: 10px; }
.ph-big b { display: block; font-size: 14px; }
.ph-big small { display: block; font-size: 11.5px; font-weight: 500; opacity: .75; margin-top: 2px; }
.ph-big-icon { font-size: 22px; line-height: 1; width: 28px; text-align: center; }
.ph-error { display: flex; align-items: flex-start; gap: 10px; }
.ph-error span { flex: 1; }
.ph-subfolders { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.ph-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--panel); border: 1px solid var(--border-2); border-radius: 7px; color: var(--text); font-size: 12.5px; cursor: pointer; }
.ph-chip:hover { border-color: var(--accent); }
.ph-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
.ph-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; cursor: default; transition: border-color .12s; }
.ph-card:hover { border-color: var(--border-2); }
.ph-card.dim, .ph-rowitem.dim { opacity: .8; border-style: dashed; }
.ph-card-head { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
.ph-card-icon { width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--border); font-size: 17px; }
.ph-card-title { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.ph-name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-sub { font-size: 12px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11.5px; }
.ph-pill { font-family: var(--mono); font-size: 11px; padding: 2px 8px; border-radius: 999px; color: var(--accent); border: 1px solid rgba(255,186,32,.45); background: rgba(255,186,32,.08); white-space: nowrap; }
.ph-pill.unknown { color: var(--text-faint); border-color: var(--border-2); background: transparent; }
.ph-folder { color: var(--text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.ph-time { color: var(--text-faint); font-family: var(--mono); font-size: 11px; white-space: nowrap; }
.ph-actions { display: flex; gap: 4px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 8px; }
.ph-act { border: 1px solid var(--border-2); background: var(--panel-2); color: var(--text-dim); border-radius: 5px; padding: 4px 9px; font-size: 12px; cursor: pointer; }
.ph-act:hover { color: var(--text); border-color: var(--text-faint); }
.ph-act.primary { background: var(--orange); color: #1a1206; border-color: var(--orange); font-weight: 700; }
.ph-act.danger:hover { color: var(--red); border-color: rgba(255,90,77,.6); }
.ph-confirm { border-top: 1px solid var(--border); padding-top: 8px; font-size: 12.5px; }
.ph-folder-menu .ph-confirm { border-top: none; padding-top: 0; }
.ph-note { font-size: 11.5px; color: var(--text-faint); margin-top: 3px; line-height: 1.4; }
.ph-pop-anchor { position: relative; display: inline-flex; }
.ph-backdrop { position: fixed; inset: 0; z-index: 40; }
.ph-popover { position: absolute; top: calc(100% + 4px); left: 0; z-index: 41; min-width: 200px; max-height: 260px; overflow-y: auto; background: var(--panel-2); border: 1px solid var(--border-2); border-radius: 7px; box-shadow: 0 10px 28px rgba(0,0,0,.55); padding: 4px; }
.ph-pop-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-faint); padding: 4px 8px; font-weight: 700; }
.ph-pop-item { display: block; width: 100%; text-align: left; border: none; background: none; color: var(--text); font-size: 12.5px; padding: 6px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.ph-pop-item:hover:not(:disabled) { background: var(--orange); color: #1a1206; }
.ph-pop-item.current { color: var(--text-faint); cursor: default; }
.ph-list { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: visible; background: var(--panel); }
.ph-rowitem { display: grid; grid-template-columns: minmax(180px, 2fr) minmax(110px, 1fr) minmax(90px, 1fr) 110px minmax(220px, 2fr); gap: 10px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.ph-rowitem:last-child { border-bottom: none; }
.ph-rowitem:hover:not(.ph-list-head) { background: var(--panel-2); }
.ph-list-head { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-faint); font-weight: 700; padding: 8px 12px; }
.ph-rowitem .ph-col-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ph-rowitem .ph-actions, .ph-rowitem .ph-confirm { border-top: none; padding-top: 0; }
.ph-rowitem .ph-actions { justify-content: flex-end; }
.ph-rowitem.dim { display: flex; flex-wrap: wrap; gap: 10px; }
.ph-rowitem.dim .ph-card-head { flex: 1; }
.ph-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 60px 20px; color: var(--text-dim); text-align: center; border: 1px dashed var(--border-2); border-radius: 12px; font-size: 14px; }
.ph-empty-icon { font-size: 34px; opacity: .6; }
`;
