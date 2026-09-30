/**
 * UpdateBanner — araç çubuğunun altında beliren güncelleme uyarısı.
 * Durumlara göre "Şimdi Güncelle / Sonra", indirme ilerlemesi, ve
 * "Yeniden Başlat ve Kur" seçeneklerini gösterir. Yalnızca masaüstünde anlamlı.
 */
import type { UpdaterState } from "./useUpdater";
import { useI18n } from "./i18n";

export default function UpdateBanner({ u }: { u: UpdaterState }) {
  const { t } = useI18n();
  if (!u.isElectron || u.dismissed) return null;
  if (u.status === "idle" || u.status === "checking") return null;

  const wrap = (children: React.ReactNode, tone: "info" | "ok" | "bad" = "info") => (
    <div className={`update-banner ${tone}`}>{children}</div>
  );

  if (u.status === "available") {
    return wrap(
      <>
        <span className="ub-text">
          ⬆ {t("Yeni sürüm mevcut{ver}. Şimdi güncellemek ister misiniz?", { ver: u.newVersion ? ` (v${u.newVersion})` : "" })}
        </span>
        <div className="ub-actions">
          <button className="btn primary ub-btn" onClick={u.download}>{t("Şimdi Güncelle")}</button>
          <button className="btn ghost ub-btn" onClick={u.dismiss}>{t("Sonra")}</button>
        </div>
      </>,
    );
  }

  if (u.status === "downloading") {
    return wrap(
      <>
        <span className="ub-text">⬇ {t("Güncelleme indiriliyor… %{p}", { p: u.progress })}</span>
        <div className="ub-progress"><div style={{ width: `${u.progress}%` }} /></div>
      </>,
    );
  }

  if (u.status === "downloaded") {
    return wrap(
      <>
        <span className="ub-text">
          ✓ {t("Güncelleme hazır{ver}. Kurmak için uygulama yeniden başlatılacak.", { ver: u.newVersion ? ` (v${u.newVersion})` : "" })}
        </span>
        <div className="ub-actions">
          <button className="btn primary ub-btn" onClick={u.install}>{t("Yeniden Başlat ve Kur")}</button>
          <button className="btn ghost ub-btn" onClick={u.dismiss}>{t("Sonra")}</button>
        </div>
      </>,
      "ok",
    );
  }

  if (u.status === "not-available") {
    return wrap(
      <>
        <span className="ub-text">✓ {t("Uygulama güncel (v{v}).", { v: u.version })}</span>
        <div className="ub-actions">
          <button className="btn ghost ub-btn" onClick={u.dismiss}>{t("Tamam")}</button>
        </div>
      </>,
      "ok",
    );
  }

  if (u.status === "error") {
    return wrap(
      <>
        <span className="ub-text">⚠ {t("Güncelleme denetlenemedi:")} {u.error}</span>
        <div className="ub-actions">
          <button className="btn ghost ub-btn" onClick={u.dismiss}>{t("Kapat")}</button>
        </div>
      </>,
      "bad",
    );
  }

  return null;
}
