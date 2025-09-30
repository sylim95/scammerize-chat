"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Onboarding from "./components/onboarding";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem"
import { Share } from "@capacitor/share"
import { Capacitor, PluginListenerHandle } from "@capacitor/core";
import { App, AppState } from '@capacitor/app';
import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  AdLoadInfo,
  AdMobError, 
} from '@capacitor-community/admob';

type ApiOk = { summary: string };
type ApiErr = { error?: string };

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  const didSetupRef = useRef(false);
  const interstitialReadyRef = useRef(false);
  const lastShownAtRef = useRef(0);
  const subsRef = useRef<PluginListenerHandle[]>([]);
  const appSubRef = useRef<PluginListenerHandle | null>(null);

  const [online, setOnline] = useState(true);
  const [loadingStage, setLoadingStage] = useState<0 | 1 | 2>(0); 

  useEffect(() => {
    const INTERSTITIAL_ID =
        String(process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL ??
        process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_TEST);

    // 네트워크 상태 표시용
    setOnline(navigator.onLine);
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
  
    const seen = localStorage.getItem('seenOnboarding');
    if (!seen) setShowOnboarding(true);
  
    const isNative = Capacitor.isNativePlatform();
  
    const MIN_INTERVAL_MS = 30_000;
  
    const loadInterstitial = async () => {
      try {
        await AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID });
      } catch (e) {
        console.debug('[AdMob] prepareInterstitial error', e);
      }
    };
  
    const setup = async () => {
      if (!isNative || didSetupRef.current) return;
      didSetupRef.current = true;
  
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
  
        await AdMob.initialize();
  
        const tracking = await AdMob.trackingAuthorizationStatus();
        if (tracking.status === 'notDetermined') {
          await AdMob.requestTrackingAuthorization();
        }
  
        try {
          const consentInfo = await AdMob.requestConsentInfo();
          if (consentInfo.isConsentFormAvailable &&
              consentInfo.status === AdmobConsentStatus.REQUIRED) {
            await AdMob.showConsentForm();
          }
        } catch (e) {
          console.log('[AdMob] Consent check skipped:', e);
        }

        // 전면 먼저 프리로드
        await loadInterstitial();
  
        // 이벤트 등록 (await로 핸들 보관)
        subsRef.current.push(
          await AdMob.addListener(InterstitialAdPluginEvents.Loaded, (_info: AdLoadInfo) => {
            interstitialReadyRef.current = true;
          })
        );
        subsRef.current.push(
          await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, (_err: AdMobError) => {
            interstitialReadyRef.current = false;
          })
        );
        subsRef.current.push(
          await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, async () => {
            interstitialReadyRef.current = false;
            await loadInterstitial();
          })
        );
        subsRef.current.push(
          await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, async (_err: AdMobError) => {
            interstitialReadyRef.current = false;
            await loadInterstitial();
          })
        );
  
        // 앱 포그라운드 복귀 시 전면 광고 노출
        appSubRef.current = await App.addListener('appStateChange', async (state: AppState) => {
          if (!state.isActive) return;
  
          const now = Date.now();
          if (now - lastShownAtRef.current < MIN_INTERVAL_MS) {
            if (!interstitialReadyRef.current) await loadInterstitial();
            return;
          }
  
          if (interstitialReadyRef.current) {
            try {
              await AdMob.showInterstitial();
              lastShownAtRef.current = Date.now();
              // 닫히면 Dismissed 이벤트에서 다시 프리로드
            } catch {
              interstitialReadyRef.current = false;
              await loadInterstitial();
            }
          } else {
            await loadInterstitial();
          }
        });
      } catch (e) {
        console.debug('[AdMob setup]', e);
      }
    };
  
    // 실행
    setup();
  
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
  
      // 리스너 해제
      subsRef.current.forEach(h => h.remove());
      subsRef.current = [];
  
      if (appSubRef.current) {
        appSubRef.current.remove();
        appSubRef.current = null;
      }
    };
  }, []);

  const onPick = (f: File | null) => {
    setError(""); setResult(""); setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!online) return;
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) onPick(f);
  }, [online]);
  
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

  const prettySize = useMemo(() => {
    if (!file) return "";
    const mb = file.size / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(file.size / 1024).toFixed(0)} KB`;
  }, [file]);

  const onSummarize = async () => {
    if (!file) return;
    setLoading(true); setError(""); setResult("");
    const fd = new FormData(); fd.append("file", file);

    // 지연 문구 타이머
    const t1 = setTimeout(() => setLoadingStage(1), 3000);   // 3s
    const t2 = setTimeout(() => setLoadingStage(2), 12000);  // 12s

    // 50초 타임아웃 Abort
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });

      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        raw = {};
      }
      const data = raw as Partial<ApiOk & ApiErr>;

      if (!res.ok) alert(data?.error || "요약에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      else setResult(data.summary || "");
    } catch (err: unknown) {
      const isAbort =
      err instanceof DOMException && err.name === "AbortError";
      if (isAbort) {
        alert("처리가 지연되어 연결을 종료했어요. 다시 시도해 주세요.");
      } else {
        alert("네트워크 오류가 발생했습니다. 연결을 확인해 주세요.");
      }
    } finally { 
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(timeoutId);
      setLoading(false);
      setLoadingStage(0); 
    }
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    alert("요약을 복사했어요.");
  };

  async function ensureFsPerms() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;
  
    try {
      const status = await Filesystem.checkPermissions();
      const needRequest =
        !status ||
        (typeof status === "object" &&
          Object.values(status).some(v => String(v) !== "granted"));
  
      if (needRequest) {
        await Filesystem.requestPermissions(); // 퍼블릭 저장소 권한 요청
      }
    } catch {
      try { await Filesystem.requestPermissions(); } catch {}
    }
  }
  
  const downloadResult = async () => {
    if (!result) return;
    const filename = `summary-${new Date().toISOString().replace(/[:]/g,'-')}.md`;

    await ensureFsPerms();
  
    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.writeFile({
          path: filename,
          data: result,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
  
        const { uri } = await Filesystem.getUri({
          path: filename,
          directory: Directory.Documents,
        });
  
        const shareUrl = Capacitor.convertFileSrc(uri);
  
        const shareResult = await Share.share({
          title: "요약 저장",
          url: shareUrl,
        });
  
        // 사용자가 아무 것도 선택 안 하고 닫은 경우
        if (!shareResult.activityType) {
          console.log("[save share canceled]");
          return;
        }
  
        console.log("[save share success]");
      } catch (e) {
        console.error("[save share error]", e);
        alert("저장 중 문제가 발생했어요. 다시 시도해 주세요.");
      }
      return;
    }
  
    // 웹용 다운로드
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const closeOnboarding = () => {
    localStorage.setItem("seenOnboarding", "1");
    setShowOnboarding(false);
  }

  return (
    <div className="wrap">
      <main className="card">
        <header className="hero">
        <div className="titleRow">
          <h1>Scammerize.AI</h1>
          <div className="infoWrap">
            <InfoIcon />
            <span className="tooltip">
              지원 포맷: PDF·DOCX·PPTX·TXT·이미지(PNG/JPG/WEBP)
            </span>
          </div>
        </div>
        <div className="toolbar">
        <div className={`pill ${online ? "ok" : "bad"}`}
            onClick={() => {
              localStorage.removeItem("seenOnboarding");
              setShowOnboarding(true);
          }}>
          {online ? "연결됨" : "오프라인"}
        </div>
        </div>
      </header>

        <section
          ref={dropRef}
          className={`drop ${file ? "has" : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          {!file ? (
            <>
              <UploadIcon />
              <div className="title">파일을 끌어다 놓거나</div>
              <label className="pick">
                기기에서 선택
                <input
                  type="file"
                  accept=".pdf,.docx,.pptx,.txt,image/*,.heic,.heif"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onPick(e.target.files?.[0] ?? null)
                  }
                  hidden
                  disabled={!online}
                />
              </label>
              <div className="hint">큰 문서도 자동으로 나눠 요약해요.</div>
            </>
          ) : (
            <div className="fileRow">
              <div className="meta">
                <div className="name" title={file.name}>{file.name}</div>
                <div className="muted">{file.type || "unknown"} · {prettySize}</div>
              </div>
              <div className="btns">
                <button className="ghost" onClick={() => onPick(null)}>변경</button>
                <button className="danger" onClick={() => { setFile(null); setResult(""); setError(""); }}>제거</button>
              </div>
            </div>
          )}
        </section>

        <section className="work">
          <div className="pad">
            {result ? (
              <article className="summary markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {result}
                </ReactMarkdown>
              </article>
            ) : (
              <div className="placeholder">
                {loading
                  ? (loadingStage === 0
                      ? "요약 중입니다..."
                      : loadingStage === 1
                        ? "조금 더 걸리고 있어요..."
                        : <>서버가 혼잡합니다.<br />곧 끝나지 않으면 잠시 후 다시 시도해 주세요.</>)
                  : "여기에 결과가 표시됩니다."}
              </div>
            )}
          </div>

          <div className="actionBar">
            <div className="left">
              <div className="label">진행 상태</div>
              <div className="bar">
                <div className="fill" style={{ width: loading ? "60%" : result ? "100%" : "0%" }} />
              </div>
            </div>
            <div className="right btns">
              <button className="primary" disabled={!file || loading} onClick={onSummarize}>
                {loading ? "요약 중…" : "요약 시작"}
              </button>
              <button className="ghost" disabled={!result} onClick={copyResult}>복사</button>
              <button className="ghost" disabled={!result} onClick={downloadResult}>저장</button>
              <button className="ghost" onClick={() => { setFile(null); setResult(""); setError(""); }}>초기화</button>
            </div>
          </div>

          {error && <div className="error" role="alert"><strong>에러:</strong> {error}</div>}
        </section>
      </main>

      {showOnboarding && <Onboarding onClose={closeOnboarding} />}

      {/* ===== 색상만 조정 (레이아웃/hover 그대로) ===== */}
      <style jsx>{`
        :global(:root) {
          /* 배경 그라데이션을 파스텔로 낮춤 */
          --bg1: #dfe7ff; /* 이전 #6a79ff */
          --bg2: #d8ecff; /* 이전 #6ec3ff */
          --bg3: #dff6ea; /* 이전 #6ee7b7 */

          /* 카드/패널/텍스트 톤: 다크 → 라이트 */
          --card: #ffffff;       /* 이전 #12151b */
          --panel: #f6f8fc;      /* 이전 #151a22 (업로드 박스 배경용) */
          --text: #0f172a;       /* 이전 #f4f7fb */
          --muted: #6b7280;      /* 이전 #9aa6b2 */
          --border: #e5e7eb;     /* 이전 #222a35 */

          --accent: #3b82f6;
          --good: #16a34a;
          --danger: #ef4444;
          --shadow: 0 20px 60px rgba(0,0,0,.08); /* 그림자도 라이트에 맞춰 약하게 */

          --sat: env(safe-area-inset-top);
          --sar: env(safe-area-inset-right);
          --sab: env(safe-area-inset-bottom);
          --sal: env(safe-area-inset-left);
        }

        :global(html){ color-scheme: light !important; }
        :global(html, body, #__next){ height:100%; }

        * { box-sizing: border-box; }
        body, html, .wrap { min-height: 100dvh; }

        :global(body){
          background:
            radial-gradient(1000px 600px at -20% -20%, rgba(110,231,183,.12), transparent),
            radial-gradient(1000px 600px at 120% -20%, rgba(110,195,255,.10), transparent),
            linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 45%, var(--bg3) 100%);
          background-attachment: fixed;
          background-color: transparent !important;
          color: var(--text);
        }

        .wrap {
          padding: calc(28px + env(safe-area-inset-top)) 16px 28px 16px;
          display: grid; 
          place-items: center;
          background:
            radial-gradient(1000px 600px at -20% -20%, rgba(110,231,183,.12), transparent),
            radial-gradient(1000px 600px at 120% -20%, rgba(110,195,255,.10), transparent),
            linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 45%, var(--bg3) 100%);
          color: var(--text);
        }

        .card {
          width: 100%;
          max-width: 920px;
          background: var(--card);
          color: var(--text);
          border-radius: 18px;
          overflow: hidden;
          box-shadow: var(--shadow);
          border: 1px solid var(--border);
        }

        .hero {
          padding: 22px 22px 16px;
          background: linear-gradient(180deg, rgba(0,0,0,0.02), transparent); /* 라이트용 */
          font-weight: 700;
        }
        .hero h1 {
          margin: 0 0 6px 0; font-size: 22px; letter-spacing: .2px; text-align: center;
        }
        .sub {
          text-align: center; color: var(--muted); font-size: 12px; margin: 0;
        }
        .toolbar { display: flex; justify-content: center; margin-top: 12px; }
        .pill {
          padding: 6px 10px; border-radius: 999px; font-size: 12px;
          border: 1px solid var(--border); background: #ffffff; color: #0f172a;
        }
        .pill.ok { border-color: rgba(22,163,74,.35); color: #065f46; background: rgba(22,163,74,.10); }
        .pill.bad { border-color: rgba(239,68,68,.35); color: #7f1d1d; background: rgba(239,68,68,.10); }

        .drop {
          margin: 16px; border: 1px dashed #d7dce3; background: var(--panel);
          border-radius: 14px; padding: 28px; display: grid; place-items: center;
          gap: 8px; text-align: center; transition: border-color .15s ease, transform .08s ease;
          color: var(--text);
        }
        .drop:hover { border-color: #c9d2df; transform: translateY(-1px); }
        .drop.has { place-items: start; text-align: left; }
        .titleRow {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        :global(.info-icon) {
          color: #6b7280;
          cursor: pointer;
        }
        :global(.info-icon:hover) {
          color: #374151;
        }
        .infoWrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          margin: 0 0 6px;
        }
        .tooltip {
            visibility: hidden;
            opacity: 0;
            position: absolute;
            top: 120%;
            left: 50%;
            transform: translateX(-50%);
            background: #111827;
            color: #f9fafb;
            font-size: 13px;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid #374151;
            transition: opacity 0.2s ease;
            z-index: 10;
            display: inline-block;
            max-width: min(80vw, 520px);
            min-width: 260px;
            white-space: normal;
            word-break: break-word;
            text-align: center;
            line-height: 1.5;
        }
        .infoWrap:hover .tooltip {
          visibility: visible;
          opacity: 1;
        }
        @media (max-width: 640px) {
          .titleRow { position: relative; }
          .infoWrap { position: static; }
          .tooltip {
            position: absolute;
            top: calc(100% + 8px);
            left: 16px;
            right: 16px;
            transform: none;
            max-width: none;
            min-width: 0;
            display: block;
            text-align: left;
            line-height: 1.5;
          }
        }  
        .hint { color: var(--muted); font-size: 12px; }

        .pick {
          display: inline-block; 
          margin-top: 4px; 
          padding: 6px 14px; 
          border-radius: 10px;
          background: #0f172a; 
          border: 1px solid #0f172a; 
          color: #fff; 
          cursor: pointer;
          font-size: 13px;
        }
        .pick:hover { background: #182235; }
        .pick.disabled {
          opacity: 0.5;
          cursor: not-allowed;
          pointer-events: none;
        }

        .fileRow {
          width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px;
        }
        .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60vw; }
        .muted { color: var(--muted); font-size: 12px; margin-top: 4px; }
        .meta { display: grid; gap: 2px; }
        .btns { display: flex; gap: 8px; }

        /* 버튼: 레이아웃/hover 유지, 색만 라이트 톤으로 */
        button {
          appearance: none; border: 1px solid var(--border); background: #ffffff; color: var(--text);
          padding: 10px 14px; border-radius: 10px; font-size: 14px; cursor: pointer;
          transition: transform .05s ease, background .15s ease, border-color .15s ease;
          min-width: 57px;
        }
        button:hover { background: #f6f7fb; border-color: #cfd6e1; }
        button:disabled { opacity: .55; cursor: not-allowed; }
        .ghost { background: transparent; }
        .danger { background: #fff5f5; color: #7f1d1d; border-color: rgba(239,68,68,.3); }
        .danger:hover { background: #fee2e2; }
        .primary {
            background: #22c55e;
            border-color: rgba(22,163,74,.45);
            color: #ffffff;
            font-weight: 800;
            box-shadow: 0 6px 26px rgba(34,197,94,.25);
            transition: filter .15s ease, background .15s ease;
        }
        .primary:hover { 
          background: #16a34a;
          border-color: rgba(22,163,74,.6);
          filter: none;  
        }

        .work { padding: 0 16px 16px; display: grid; gap: 12px; }

        /* 결과 텍스트박스: 흰 카드 + 진한 글자 */
        .pad {
          background: #ffffff; border: 1px solid var(--border); border-radius: 14px; min-height: 360px;
          padding: 18px; display: grid; align-items: start; color: var(--text);
          box-shadow: var(--shadow);
          min-width: 0;
        }
        .placeholder { color: var(--muted); text-align: center; margin: 24px 0; font-size: 13px; }
        .summary,
        .summary.markdown {
          overflow-wrap: anywhere;
          word-break: break-word;
          hyphens: auto;
          -webkit-hyphens: auto;
          line-height: 1.75;
          letter-spacing: .1px;
          min-width: 0;
          font-size: 15px;
        }

        /* 하단 바: 라이트 카드 */
        .actionBar {
          display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
          background: #ffffff; border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px;
          box-shadow: var(--shadow);
        }
        .left { display: grid; gap: 6px; }
        .label { color: var(--muted); font-size: 13px; }
        .bar {
          width: 100%;           
          max-width: 500px;  
          height: 10px;
          border-radius: 999px;
          background: #e5e7eb;
          overflow: hidden;
          border: 1px solid #d1d5db;
          margin-top: 6px;  
        }
        .fill { height: 100%; background: linear-gradient(90deg, #60a5fa, #22c55e); transition: width .3s ease; }

        .error {
          border: 1px solid rgba(239,68,68,.35); background: #fff5f5;
          color: #7f1d1d; padding: 10px 12px; border-radius: 10px;
        }

        .toast {
          position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
          background: rgba(15,23,36,.9); color: #e5eefb; border: 1px solid #263244; padding: 10px 14px;
          border-radius: 10px; box-shadow: var(--shadow); font-size: 14px;
        }

        @media (max-width: 640px) {
          .actionBar { grid-template-columns: 1fr; gap: 10px; }
          .bar { width: 100%; }
          .right { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        }

        .summary.markdown :global(h1),
        .summary.markdown :global(h2),
        .summary.markdown :global(h3) {
          margin: 10px 0 6px;
          font-weight: 700;
          line-height: 1.35;
        }
        .summary.markdown :global(h1){ font-size: 20px; }
        .summary.markdown :global(h2){ font-size: 18px; }
        .summary.markdown :global(h3){ font-size: 16px; }

        .summary.markdown :global(ul),
        .summary.markdown :global(ol){
          padding-left: 16px;
        }

        .summary.markdown :global(strong){ font-weight: 700; }
        .summary.markdown :global(code){
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          background: #f3f4f6;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 0 6px;
        }
        .summary.markdown :global(pre){
          background: #0f172a;
          color: #e5e7eb;
          border-radius: 8px;
          padding: 12px;
          overflow: auto;
          border: 1px solid #1f2937;
        }
        .summary.markdown :global(img){
          max-width:100%;
          height:auto;
        }
        .summary.markdown :global(p){
          margin: 14px 0;
        }
      `}</style>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V7m0 0l-3.5 3.5M12 7l3.5 3.5" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="12" cy="5" r="2.2" fill="#2563eb" opacity=".12"/>
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="info-icon"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="8" />
    </svg>
  );
}