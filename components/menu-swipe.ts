// Gesto do menu lateral no celular: deslizar para a esquerda abre, para a direita fecha.
// A gaveta acompanha o dedo; ao soltar, completa o movimento se passou de 30% da largura
// ou se o gesto foi rápido. Rolagem vertical, campos de texto e áreas que rolam na
// horizontal (tabelas, carrosséis) nunca disparam o menu.

export const SWIPE = { start: 10, ratio: 1.3, distance: 0.3, velocity: 0.45 } as const;

type Mode = "open" | "close";
type Options = { onOpen: () => void; onClose: () => void; enabled: () => boolean };

// Decide se o primeiro movimento é um gesto do menu (horizontal e na direção certa).
export function swipeIntent(dx: number, dy: number, mode: Mode): "menu" | "scroll" | "wait" {
  if (Math.abs(dx) < SWIPE.start && Math.abs(dy) < SWIPE.start) return "wait";
  const horizontal = Math.abs(dx) > Math.abs(dy) * SWIPE.ratio;
  const rightWay = mode === "open" ? dx < 0 : dx > 0;
  return horizontal && rightWay ? "menu" : "scroll";
}

// Ao soltar: o menu termina aberto?
export function settlesOpen(mode: Mode, dx: number, ms: number, width: number) {
  const speed = dx / Math.max(ms, 1);
  if (mode === "open") return -dx > width * SWIPE.distance || speed < -SWIPE.velocity;
  return !(dx > width * SWIPE.distance || speed > SWIPE.velocity);
}

function blocked(target: EventTarget | null) {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (el.matches("input,textarea,select,[contenteditable=true],[data-no-swipe]")) return true;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2) return true;
  }
  return false;
}

function otherOverlayOpen(menu: HTMLDialogElement) {
  if ([...document.querySelectorAll("dialog[open]")].some(d => d !== menu)) return true;
  return !!document.querySelector(".modal:not(.hidden),.billing-modal-backdrop:not(.hidden):not([hidden])");
}

export function attachMenuSwipe(menu: HTMLDialogElement, { onOpen, onClose, enabled }: Options) {
  let mode: Mode | null = null, decided = false, dragging = false;
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, width = 0;
  // Movimento de assentamento ainda em curso (abrir/fechar após soltar o dedo).
  let pending: (() => void) | null = null;

  const place = (offset: number) => {
    menu.style.transform = `translateX(${Math.max(0, Math.min(width, offset))}px)`;
    menu.style.setProperty("--menu-progress", String(1 - Math.max(0, Math.min(width, offset)) / width));
  };
  // Limpa só a posição do arrasto. A animação de entrada continua desligada enquanto o menu
  // estiver aberto: religá-la aqui faria o navegador tocá-la de novo (a "piscada").
  const reset = () => {
    menu.style.transition = ""; menu.style.transform = "";
    menu.style.removeProperty("--menu-progress");
  };
  const settle = (open: boolean) => {
    menu.style.transition = "transform .2s cubic-bezier(.2,.8,.2,1)";
    place(open ? 0 : width);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      pending = null;
      menu.removeEventListener("transitionend", done);
      // Fechar antes de limpar a posição: senão a gaveta reaparece aberta por um quadro.
      if (!open) onClose();
      reset();
    };
    pending = done;
    menu.addEventListener("transitionend", done);
    window.setTimeout(done, 260);
  };
  // A animação de entrada volta a valer só depois que o menu fecha (para o botão do cabeçalho).
  const restoreAnimation = () => { menu.style.animation = ""; };
  menu.addEventListener("close", restoreAnimation);

  const start = (event: TouchEvent) => {
    mode = null; decided = false; dragging = false;
    // Um novo toque conclui na hora o movimento anterior, para os dois não se misturarem.
    pending?.();
    if (!enabled() || event.touches.length !== 1) return;
    if (menu.open) mode = "close";
    else if (!otherOverlayOpen(menu) && !blocked(event.target)) mode = "open";
    else return;
    x0 = event.touches[0].clientX; y0 = event.touches[0].clientY; t0 = performance.now(); dx = 0;
  };
  const move = (event: TouchEvent) => {
    if (!mode) return;
    dx = event.touches[0].clientX - x0;
    const dy = event.touches[0].clientY - y0;
    if (!decided) {
      const intent = swipeIntent(dx, dy, mode);
      if (intent === "wait") return;
      decided = true;
      if (intent === "scroll") { mode = null; return; }
      dragging = true;
      if (mode === "open") { onOpen(); menu.style.animation = "none"; }
      width = menu.getBoundingClientRect().width || 320;
      menu.style.transition = "none";
    }
    if (!dragging) return;
    event.preventDefault();
    place(mode === "open" ? width + dx : dx);
  };
  const end = () => {
    if (!dragging || !mode) { mode = null; return; }
    settle(settlesOpen(mode, dx, performance.now() - t0, width));
    mode = null; dragging = false;
  };

  document.addEventListener("touchstart", start, { passive: true });
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);
  return {
    // Fechar pelo X ou tocando fora também desliza a gaveta para fora.
    slideOut() { width = menu.getBoundingClientRect().width || 320; menu.style.transition = "none"; place(0); void menu.offsetWidth; settle(false); },
    detach() {
      menu.removeEventListener("close", restoreAnimation);
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    },
  };
}
