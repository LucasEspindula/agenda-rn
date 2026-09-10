"use client";

import { useEffect, useRef } from "react";

export function LoginScene() {
  const scene = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (motion.matches || event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scene.current?.style.setProperty("--dx", `${(event.clientX / window.innerWidth - .5) * 45}px`);
        scene.current?.style.setProperty("--dy", `${(event.clientY / window.innerHeight - .5) * 45}px`);
        scene.current?.style.setProperty("--mx", `${event.clientX}px`);
        scene.current?.style.setProperty("--my", `${event.clientY}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); };
  }, []);
  return <div ref={scene} className="login-scene" aria-hidden="true">
    <div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" />
    <div className="login-orbit orbit-three" /><div className="login-spotlight" />
  </div>;
}
