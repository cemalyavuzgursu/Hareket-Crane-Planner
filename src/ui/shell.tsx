/**
 * shell.tsx — CAD masaüstü kabuğu için yeniden kullanılabilir bileşenler:
 *   - Section    : panel içi katlanır akordeon bölüm
 *   - SidePanel  : katlanabilir yan panel (katlanınca ikon şeridine düşer)
 *   - Menu       : menü çubuğu açılır menüsü
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "./i18n";

/** Panel içi katlanır bölüm (akordeon). */
export function Section({
  title,
  icon,
  defaultOpen = true,
  right,
  children,
}: {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="acc">
      <button className="acc-head" onClick={() => setOpen((o) => !o)} type="button">
        <span className="acc-chev">{open ? "▾" : "▸"}</span>
        {icon && <span className="acc-icon">{icon}</span>}
        <span className="acc-title">{title}</span>
        {right}
      </button>
      {open && <div className="acc-body">{children}</div>}
    </div>
  );
}

export interface RailIcon {
  icon: string;
  label: string;
}

/** Katlanabilir yan panel. Katlanınca ince ikon şeridine düşer. */
export function SidePanel({
  side,
  title,
  collapsed,
  onToggle,
  railIcons,
  children,
}: {
  side: "left" | "right";
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  railIcons?: RailIcon[];
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (collapsed) {
    return (
      <div className={`panel-col ${side} collapsed`}>
        <button
          className="panel-expand"
          title={t("{title} panelini genişlet", { title })}
          onClick={onToggle}
          type="button"
        >
          {side === "left" ? "»" : "«"}
        </button>
        {railIcons?.map((r, i) => (
          <div key={i} className="rail-icon" title={r.label} onClick={onToggle}>
            {r.icon}
          </div>
        ))}
        <div className="rail-title">{title}</div>
      </div>
    );
  }
  return (
    <div className={`panel-col ${side}`}>
      <div className="panel-head">
        <span className="panel-head-title">{title}</span>
        <button className="panel-collapse" title={t("Paneli katla")} onClick={onToggle} type="button">
          {side === "left" ? "«" : "»"}
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

export interface MenuAction {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** Seçili/aktif öğe işareti (✓). */
  checked?: boolean;
}

/** Menü çubuğu öğesi + açılır menü. */
export function Menu({ label, items }: { label: string; items: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="menu-item" ref={ref} onClick={() => setOpen((o) => !o)}>
      {label}
      {open && (
        <div className="menu-pop" onClick={(e) => e.stopPropagation()}>
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="sep" />
            ) : (
              <div
                key={i}
                className={`mi ${it.disabled ? "disabled" : ""}`}
                onClick={() => {
                  if (it.disabled) return;
                  it.onClick?.();
                  setOpen(false);
                }}
              >
                <span>
                  {it.checked != null && (
                    <span style={{ display: "inline-block", width: 14, opacity: it.checked ? 1 : 0 }}>✓</span>
                  )}
                  {it.label}
                </span>
                {it.shortcut && <span className="sc">{it.shortcut}</span>}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
