"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Slide = { title: string; desc: string; emoji?: string };

const SLIDES: Slide[] = [
  { emoji:"✨", title:"Scammerize.AI", desc:"PDF·DOCX·이미지에서 핵심만 뽑아 요약해줘요." },
  { emoji:"📄", title:"문서·이미지 업로드", desc:"드래그&드롭 또는 ‘기기에서 선택’으로 올리면 끝!" },
  { emoji:"⚡", title:"빠른 요약", desc:"긴 문서도 자동 분할해서 깔끔한 bullet로 정리해요." },
  { emoji:"🔒", title:"안전", desc:"요약에 필요한 최소 정보만 처리해요." },
];

export default function Onboarding({
  onClose,
}: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const timerRef = useRef<number | null>(null);
  const prefersReduceMotion = useMemo(
    () => globalThis?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false,
    []
  );

  // 자동 진행
  useEffect(() => {
    if (prefersReduceMotion) return;
    timerRef.current && window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setI((p) => (p + 1) % SLIDES.length);
    }, 1800);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [prefersReduceMotion]);

  // 터치 스와이프
  useEffect(() => {
    const wrap = document.getElementById("ob-wrap");
    if (!wrap) return;
    let sx = 0, dx = 0;
    const onStart = (e: TouchEvent) => (sx = e.touches[0].clientX);
    const onMove  = (e: TouchEvent) => (dx = e.touches[0].clientX - sx);
    const onEnd   = () => {
      if (Math.abs(dx) > 50) {
        setI((p) => (dx < 0 ? (p + 1) % SLIDES.length : (p - 1 + SLIDES.length) % SLIDES.length));
      }
      sx = dx = 0;
    };
    wrap.addEventListener("touchstart", onStart, { passive: true });
    wrap.addEventListener("touchmove", onMove, { passive: true });
    wrap.addEventListener("touchend", onEnd);
    return () => {
      wrap.removeEventListener("touchstart", onStart);
      wrap.removeEventListener("touchmove", onMove);
      wrap.removeEventListener("touchend", onEnd);
    };
  }, []);

  const closeAndRemember = () => {
    try { localStorage.setItem("seenOnboarding", "1"); } catch {}
    onClose();
  };

  return (
    <div className="ob-backdrop">
      <div id="ob-wrap" className="ob-card">
        <button className="ob-skip" onClick={closeAndRemember}>건너뛰기</button>
        <div className="ob-viewport">
          <div className="ob-track" style={{ transform:`translateX(${-i * 100}%)` }}>
            {SLIDES.map((s, idx) => (
              <section className="ob-slide" key={idx} aria-roledescription="slide" aria-label={`${idx+1}/${SLIDES.length}`}>
                <div className="ob-emoji">{s.emoji}</div>
                <h2>{s.title}</h2>
                <p>{s.desc}</p>
              </section>
            ))}
          </div>
        </div>
        <div className="ob-dots">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              className={"ob-dot" + (idx === i ? " on" : "")}
              aria-label={`슬라이드 ${idx+1}`}
              onClick={() => setI(idx)}
            />
          ))}
        </div>
        <button className="ob-cta" onClick={closeAndRemember}>시작하기</button>
      </div>

      {/* 스타일 (프로젝트 톤 맞춰 최소만) */}
      <style jsx>{`
        .ob-backdrop {
          position: fixed; inset: 0; z-index: 9999;
          background: linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.15));
          display: grid; place-items: center;
          backdrop-filter: blur(2px);
        }
        .ob-card {
          width: min(520px, calc(100vw - 32px));
          background: var(--card, #fff);
          color: var(--text, #0f172a);
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 16px; box-shadow: var(--shadow, 0 20px 60px rgba(0,0,0,.12));
          padding: 18px 16px 16px; position: relative;
          animation: pop .18s ease-out;
        }
        @keyframes pop { from { transform: scale(.98); opacity:.0 } to { transform: scale(1); opacity:1 } }

        .ob-skip {
          position: absolute; top: 10px; right: 12px;
          background: transparent; border: 0; color: var(--muted,#6b7280); cursor: pointer;
        }
        .ob-viewport { overflow: hidden; width: 100%; margin-top: 12px; }
        .ob-track { display: flex; transition: transform .35s ease; width: 100%; }
        .ob-slide { flex: 0 0 100%; text-align: center; padding: 10px 8px 0; }
        .ob-emoji { font-size: 38px; margin-bottom: 8px; }
        .ob-slide h2 { font-size: 20px; margin: 6px 0 4px; }
        .ob-slide p { font-size: 14px; color: var(--muted,#6b7280); margin: 0; }

        .ob-dots { display: flex; gap: 6px; justify-content: center; margin: 12px 0 10px; }
        .ob-dot { width: 8px; height: 8px; border-radius: 999px; border: 0; background:#d1d5db; }
        .ob-dot.on { width: 18px; background:#60a5fa; transition: all .2s; }

        .ob-cta {
          width: 100%; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(22,163,74,.45);
          background: #22c55e; color:#fff; font-weight: 800; cursor: pointer;
        }
      `}</style>
    </div>
  );
}