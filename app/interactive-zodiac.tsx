"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; vx: number; vy: number; radius: number; alpha: number };

export function InteractiveZodiac() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: -1000, y: -1000, active: false };
    let stars: Star[] = [];
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(38, Math.min(92, Math.round((width * height) / 18000)));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.075,
        vy: (Math.random() - 0.5) * 0.075,
        radius: 0.7 + Math.random() * 1.25,
        alpha: 0.35 + Math.random() * 0.55,
      }));
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      root.style.setProperty("--zodiac-x", `${(event.clientX / width - 0.5) * -18}px`);
      root.style.setProperty("--zodiac-y", `${(event.clientY / height - 0.5) * -18}px`);
      root.style.setProperty("--glow-x", `${event.clientX}px`);
      root.style.setProperty("--glow-y", `${event.clientY}px`);
    };

    const onPointerLeave = () => {
      pointer.active = false;
      root.style.setProperty("--zodiac-x", "0px");
      root.style.setProperty("--zodiac-y", "0px");
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (const star of stars) {
        if (!reducedMotion.matches) {
          star.x = (star.x + star.vx + width) % width;
          star.y = (star.y + star.vy + height) % height;
        }
        context.beginPath();
        context.fillStyle = `rgba(216,240,255,${star.alpha})`;
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();

        if (!pointer.active || reducedMotion.matches) continue;
        const dx = pointer.x - star.x;
        const dy = pointer.y - star.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 145) {
          context.beginPath();
          context.strokeStyle = `rgba(95,224,219,${(1 - distance / 145) * 0.45})`;
          context.lineWidth = 0.8;
          context.moveTo(star.x, star.y);
          context.lineTo(pointer.x, pointer.y);
          context.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    draw();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return <div ref={rootRef} aria-hidden="true" className="zodiac-scene pointer-events-none absolute inset-0 overflow-hidden">
      <div className="zodiac-map absolute -inset-6 bg-[url('/zodiac-login-bg.webp')] bg-cover bg-center" />
    <div className="zodiac-pointer-glow absolute inset-0" />
    <canvas ref={canvasRef} className="absolute inset-0" />
  </div>;
}
