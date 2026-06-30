/**
 * UpdateBanner — araç çubuğunun altında beliren güncelleme uyarısı.
 * Durumlara göre "Şimdi Güncelle / Sonra", indirme ilerlemesi, ve
 * "Yeniden Başlat ve Kur" seçeneklerini gösterir. Yalnızca masaüstünde anlamlı.
 */
import type { UpdaterState } from "./useUpdater";

export default function UpdateBanner({ u }: { u: UpdaterState }) {
  if (!u.isElectron || u.dismissed) return null;
  if (u.status === "idle" || u.status === "checking") return null;

  const wrap = (children: React.ReactNode, tone: "info" | "ok" | "bad" = "info") => (
    <div className={`update-banner ${tone}`}>{children}</div>
  );

  if (u.status === "available") {
    return wrap(
      <>
        <span className="ub-text">
          ⬆ Yeni sürüm mevcut{u.newVersion ? ` (v${u.newVersion})` : ""}. Şimdi güncellemek ister misiniz?
        </span>
        <div className="ub-actions">
          <button className="btn primary ub-btn" onClick={u.download}>Şimdi Güncelle</button>
          <button className="btn ghost ub-btn" onClick={u.dismiss}>Sonra</button>
        </div>
      </>,
    );
  }

  if (u.status === "downloading") {
    return wrap(
      <>
        <span className="ub-text">⬇ Güncelleme indiriliyor… %{u.progress}</span>
        <div className="ub-progress"><div style={{ width: `${u.progress}%` }} /></div>
      </>,
    );
  }

  if (u.status === "downloaded") {
    return wrap(
      <>
        <span className="ub-text">
          ✓ Güncelleme hazır{u.newVersion ? ` (v${u.newVersion})` : ""}. Kurmak için uygulama yeniden başlatılacak.
        </span>
        <div className="ub-actions">
          <button className="btn primary ub-btn" onClick={u.install}>Yeniden Başlat ve Kur</button>
          <button className="btn ghost ub-btn" onClick={u.dismiss}>Sonra</button>
        </div>
      </>,
      "ok",
    );
  }

  if (u.status === "not-available") {
    return wrap(
      <>
        <span className="ub-text">✓ Uygulama güncel (v{u.version}).</span>
        <div className="ub-actions">
          <button className="btn ghost ub-btn" onClick={u.dismiss}>Tamam</button>
        </div>
      </>,
      "ok",
    );
  }

  if (u.status === "error") {
    return wrap(
      <>
        <span className="ub-text">⚠ Güncelleme denetlenemedi: {u.error}</span>
        <div className="ub-actions">
          <button className="btn ghost ub-btn" onClick={u.dismiss}>Kapat</button>
        </div>
      </>,
      "bad",
    );
  }

  return null;
}
