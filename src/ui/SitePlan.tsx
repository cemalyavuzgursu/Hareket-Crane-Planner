/**
 * SitePlan.tsx — Saha planı (Liebherr Crane Planner 2.0 "Google Maps" benzeri).
 *
 * Google Maps JavaScript API (uydu) üzerine vincin saha bağlamını çizer:
 *   - Çalışma yarıçapı dairesi (metre)
 *   - Outrigger ayak izi dikdörtgeni (slew açısıyla döner)
 *   - Vinç merkezi işareti
 *   - Çevre nesnelerinin ayak izleri (çakışanlar kırmızı)
 *
 * API anahtarı kullanıcıdan alınır ve localStorage'da saklanır. Anahtar yoksa
 * bir kurulum ekranı gösterilir. Google Maps tek seferlik script ile yüklenir;
 * anahtar değişimi sayfa yenilemesi gerektirir.
 */
import { useEffect, useRef, useState } from "react";
import type { SceneObject } from "../engine/types";

export interface SitePlanProps {
  Lx: number; // ayak açıklığı X (m)
  Ly: number; // ayak açıklığı Y (m)
  radius: number; // çalışma yarıçapı (m)
  slewAngle: number; // dönme açısı (derece)
  objects: SceneObject[];
  collidingIds: string[];
}

const KEY_LS = "hareket_gmaps_key";
const CENTER_LS = "hareket_site_center";

// Google Maps script'ini tek sefer yükle. Anahtar değişirse yeniden yüklenmez
// (Google API tek örnek); bu durumda sayfa yenilemesi gerekir.
let loaderPromise: Promise<any> | null = null;
function loadGoogleMaps(key: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const cb = "__hareket_gmaps_cb";
    w[cb] = () => resolve(w.google);
    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?key=" +
      encodeURIComponent(key) +
      "&libraries=geometry&loading=async&callback=" +
      cb;
    s.async = true;
    s.onerror = () => reject(new Error("Google Maps yüklenemedi (anahtar veya ağ hatası)."));
    document.head.appendChild(s);
  });
  return loaderPromise;
}

export default function SitePlan({ Lx, Ly, radius, slewAngle, objects, collidingIds }: SitePlanProps) {
  const [key, setKey] = useState<string>(() => {
    try { return localStorage.getItem(KEY_LS) ?? ""; } catch { return ""; }
  });
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [err, setErr] = useState("");

  const mapDiv = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const centerRef = useRef<any>(null);
  const overlays = useRef<any[]>([]);

  // Anahtar varsa haritayı yükle ve başlat.
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setStatus("loading");
    setErr("");
    loadGoogleMaps(key)
      .then((google) => {
        if (cancelled || !mapDiv.current) return;
        let center = { lat: 41.0082, lng: 28.9784 }; // varsayılan: İstanbul
        try {
          const saved = localStorage.getItem(CENTER_LS);
          if (saved) center = JSON.parse(saved);
        } catch { /* yoksay */ }
        const map = new google.maps.Map(mapDiv.current, {
          center,
          zoom: 19,
          mapTypeId: "satellite",
          tilt: 0,
          streetViewControl: false,
          mapTypeControl: true,
          fullscreenControl: true,
        });
        mapObj.current = map;
        centerRef.current = new google.maps.LatLng(center.lat, center.lng);
        map.addListener("click", (e: any) => {
          centerRef.current = e.latLng;
          try {
            localStorage.setItem(
              CENTER_LS,
              JSON.stringify({ lat: e.latLng.lat(), lng: e.latLng.lng() }),
            );
          } catch { /* yoksay */ }
          draw();
        });
        setStatus("ready");
        draw();
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Geometri değişince yeniden çiz.
  useEffect(() => {
    if (status === "ready") draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Lx, Ly, radius, slewAngle, objects, collidingIds, status]);

  function clearOverlays() {
    overlays.current.forEach((o) => o.setMap && o.setMap(null));
    overlays.current = [];
  }

  function draw() {
    const google = (window as any).google;
    const map = mapObj.current;
    const center = centerRef.current;
    if (!google?.maps?.geometry || !map || !center) return;
    const sph = google.maps.geometry.spherical;
    clearOverlays();

    const push = (o: any) => overlays.current.push(o);

    // Çalışma yarıçapı dairesi
    push(
      new google.maps.Circle({
        map,
        center,
        radius: Math.max(radius, 0.1),
        strokeColor: "#5ad1ff",
        strokeWeight: 2,
        fillColor: "#5ad1ff",
        fillOpacity: 0.08,
        clickable: false,
      }),
    );

    // Outrigger ayak izi dikdörtgeni (slew açısıyla döner; +x ileri = baz yön)
    const oc = [
      [Lx / 2, Ly / 2],
      [Lx / 2, -Ly / 2],
      [-Lx / 2, -Ly / 2],
      [-Lx / 2, Ly / 2],
    ].map(([fx, ly]) => {
      const dist = Math.hypot(fx, ly);
      const heading = (Math.atan2(ly, fx) * 180) / Math.PI + slewAngle;
      return sph.computeOffset(center, dist, heading);
    });
    push(
      new google.maps.Polygon({
        map,
        paths: oc,
        strokeColor: "#ffba20",
        strokeWeight: 2,
        fillColor: "#ffba20",
        fillOpacity: 0.12,
        clickable: false,
      }),
    );

    // Vinç merkezi
    push(
      new google.maps.Marker({
        map,
        position: center,
        title: "Vinç merkezi",
        label: { text: "⊕", color: "#ffffff", fontSize: "16px" },
      }),
    );

    // Çevre nesneleri (ayak izi + etiket)
    const collSet = new Set(collidingIds);
    objects.forEach((o) => {
      const dist = Math.hypot(o.x, o.z);
      const heading = (Math.atan2(o.z, o.x) * 180) / Math.PI;
      const pos = dist > 0 ? sph.computeOffset(center, dist, heading) : center;
      const hit = collSet.has(o.id);
      const w2 = Math.max(o.width, 0.1) / 2;
      const d2 = Math.max(o.depth, 0.1) / 2;
      const rect = [
        [w2, d2],
        [w2, -d2],
        [-w2, -d2],
        [-w2, d2],
      ].map(([rx, rz]) => {
        const rd = Math.hypot(rx, rz);
        const rh = (Math.atan2(rz, rx) * 180) / Math.PI + (o.rotationY ?? 0);
        return sph.computeOffset(pos, rd, rh);
      });
      push(
        new google.maps.Polygon({
          map,
          paths: rect,
          strokeColor: hit ? "#ff5a4d" : "#cbd5e1",
          strokeWeight: 1.5,
          fillColor: hit ? "#ff5a4d" : "#94a3b8",
          fillOpacity: hit ? 0.45 : 0.4,
          clickable: false,
        }),
      );
      push(
        new google.maps.Marker({
          map,
          position: pos,
          label: { text: o.label, color: "#ffffff", fontSize: "11px" },
        }),
      );
    });
  }

  function saveKey(k: string) {
    const v = k.trim();
    if (!v) return;
    try { localStorage.setItem(KEY_LS, v); } catch { /* yoksay */ }
    setKey(v);
  }

  // ── Anahtar yoksa kurulum ekranı ────────────────────────────────────────────
  if (!key) {
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
        <div className="card">
          <h3>🛰 Saha Planı — Google Maps Kurulumu</h3>
          <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
            Uydu görüntüsü üzerine vincin çalışma yarıçapını, ayak izini ve çevre
            nesnelerini yerleştirmek için bir <b>Google Maps JavaScript API</b>{" "}
            anahtarı gerekir.
          </p>
          <ol style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.7, paddingLeft: 18 }}>
            <li>
              <a href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noreferrer"
                 style={{ color: "var(--accent)" }}>Google Cloud Console</a>'da bir proje açın.
            </li>
            <li>"Maps JavaScript API"yi etkinleştirin ve faturalandırmayı açın.</li>
            <li>Bir API anahtarı oluşturup aşağıya yapıştırın (tarayıcıda saklanır).</li>
          </ol>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Google Maps API Anahtarı</label>
            <input
              type="text"
              value={draft}
              placeholder="AIza..."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveKey(draft); }}
            />
          </div>
          <button className="btn primary" onClick={() => saveKey(draft)} disabled={!draft.trim()}>
            Anahtarı Kaydet ve Haritayı Yükle
          </button>
          <div className="disclaimer" style={{ marginTop: 10 }}>
            Anahtar yalnızca bu tarayıcıda/uygulamada saklanır, sunucuya gönderilmez.
            Faturalandırma ve kullanım sizin Google hesabınıza tabidir.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={mapDiv} style={{ position: "absolute", inset: 0 }} />
      {status !== "ready" && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          background: "rgba(12,14,17,.6)", pointerEvents: "none",
        }}>
          <div className="card" style={{ pointerEvents: "auto", maxWidth: 420 }}>
            {status === "error" ? (
              <>
                <div className="error-box" style={{ marginBottom: 8 }}>⚠ {err}</div>
                <button className="btn ghost" onClick={resetKey}>Anahtarı Değiştir</button>
              </>
            ) : (
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Harita yükleniyor…</div>
            )}
          </div>
        </div>
      )}
      {status === "ready" && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          background: "rgba(12,14,17,.82)", border: "1px solid var(--border-2)",
          borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--text)",
          fontFamily: "var(--mono)", lineHeight: 1.6, maxWidth: 280,
        }}>
          <div>📍 Vinç konumunu haritaya tıklayarak ayarlayın</div>
          <div style={{ color: "var(--blue)" }}>◯ Yarıçap {radius} m · ⬜ Ayak {Lx}×{Ly} m</div>
          <div style={{ color: "var(--text-dim)" }}>Dönme {slewAngle}° · {objects.length} nesne</div>
          <button className="btn ghost" style={{ marginTop: 6, padding: "4px 8px", fontSize: 11 }} onClick={resetKey}>
            API Anahtarını Değiştir
          </button>
        </div>
      )}
    </div>
  );

  function resetKey() {
    try { localStorage.removeItem(KEY_LS); } catch { /* yoksay */ }
    loaderPromise = null;
    setKey("");
    setStatus("idle");
  }
}
