// Pointer-based drag & drop that works the same with a mouse and on iOS touch,
// where HTML5 drag events are unreliable.
//   mouse: drag starts after moving 5px
//   touch: long-press (280ms) starts a drag; a quick horizontal swipe triggers onSwipe
// Drop targets: elements with [data-drop]. A target with [data-drop-list] gets a placeholder
// between its .wp-card children; others (day pills on mobile) just highlight.

export interface DragCallbacks {
  onDrop(id: string, target: string, beforeId: string | null): void;
  onSwipe?(id: string, dir: "left" | "right"): void;
}

const LONG_PRESS = 280;
const SWIPE_TRIGGER = 80;

export class DragController {
  private card: HTMLElement | null = null;
  private id = "";
  private startX = 0;
  private startY = 0;
  private mode: "idle" | "pending" | "drag" | "swipe" = "idle";
  private timer: number | null = null;
  private ghost: HTMLElement | null = null;
  private placeholder: HTMLElement;
  private offsetX = 0;
  private offsetY = 0;
  private target: HTMLElement | null = null;
  private beforeId: string | null = null;
  private suppressClick = false;
  private scrollTimer: number | null = null;
  private lastX = 0;
  private lastY = 0;

  constructor(private root: HTMLElement, private cb: DragCallbacks) {
    this.placeholder = createDiv({ cls: "wp-placeholder" });
    root.addEventListener("mousedown", this.onMouseDown);
    root.addEventListener("touchstart", this.onTouchStart, { passive: true });
    root.addEventListener("click", this.onClickCapture, true);
    root.addEventListener("contextmenu", this.onContextMenu, true);
  }

  destroy() {
    this.root.removeEventListener("mousedown", this.onMouseDown);
    this.root.removeEventListener("touchstart", this.onTouchStart);
    this.root.removeEventListener("click", this.onClickCapture, true);
    this.root.removeEventListener("contextmenu", this.onContextMenu, true);
    this.cleanup();
  }

  get dragging() {
    return this.mode === "drag" || this.mode === "swipe";
  }

  private cardFrom(e: Event): HTMLElement | null {
    const el = e.target as HTMLElement;
    if (el.closest("input, button, a, .wp-no-drag")) return null;
    return el.closest<HTMLElement>(".wp-card[data-id]");
  }

  // ----- mouse -----
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const card = this.cardFrom(e);
    if (!card) return;
    this.begin(card, e.clientX, e.clientY);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.mode === "pending" && Math.hypot(e.clientX - this.startX, e.clientY - this.startY) > 5) this.startDrag();
    if (this.mode === "drag") {
      e.preventDefault();
      this.moveDrag(e.clientX, e.clientY);
    }
  };
  private onMouseUp = () => {
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseup", this.onMouseUp);
    this.finish();
  };

  // ----- touch -----
  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const card = this.cardFrom(e);
    if (!card) return;
    const t = e.touches[0];
    this.begin(card, t.clientX, t.clientY);
    this.timer = window.setTimeout(() => {
      if (this.mode === "pending") {
        navigator.vibrate?.(15);
        this.startDrag();
      }
    }, LONG_PRESS);
    document.addEventListener("touchmove", this.onTouchMove, { passive: false });
    document.addEventListener("touchend", this.onTouchEnd);
    document.addEventListener("touchcancel", this.onTouchEnd);
  };
  private onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    if (this.mode === "pending" && Math.hypot(dx, dy) > 8) {
      this.clearTimer();
      if (this.cb.onSwipe && Math.abs(dx) > Math.abs(dy) * 1.5) {
        this.mode = "swipe";
        this.card!.addClass("is-swiping");
      } else {
        this.mode = "idle"; // let the page scroll
        this.removeTouchListeners();
        return;
      }
    }
    if (this.mode === "drag") {
      e.preventDefault();
      this.moveDrag(t.clientX, t.clientY);
    } else if (this.mode === "swipe") {
      e.preventDefault();
      this.card!.style.transform = `translateX(${dx}px)`;
      this.card!.toggleClass("swipe-right", dx > SWIPE_TRIGGER);
      this.card!.toggleClass("swipe-left", dx < -SWIPE_TRIGGER);
      this.lastX = t.clientX;
    }
  };
  private onTouchEnd = () => {
    this.removeTouchListeners();
    this.finish();
  };
  private removeTouchListeners() {
    document.removeEventListener("touchmove", this.onTouchMove);
    document.removeEventListener("touchend", this.onTouchEnd);
    document.removeEventListener("touchcancel", this.onTouchEnd);
  }

  // ----- shared -----
  private begin(card: HTMLElement, x: number, y: number) {
    this.card = card;
    this.id = card.dataset.id!;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.mode = "pending";
  }

  private startDrag() {
    if (!this.card) return;
    this.mode = "drag";
    const r = this.card.getBoundingClientRect();
    this.offsetX = this.startX - r.left;
    this.offsetY = this.startY - r.top;
    this.ghost = this.card.cloneNode(true) as HTMLElement;
    this.ghost.addClass("wp-ghost");
    this.ghost.style.width = `${r.width}px`;
    document.body.appendChild(this.ghost);
    this.placeholder.style.height = `${r.height}px`;
    this.card.addClass("is-dragging");
    document.body.addClass("wp-is-dragging");
    this.moveDrag(this.startX, this.startY);
    this.scrollTimer = window.setInterval(() => this.autoScroll(), 16);
  }

  private moveDrag(x: number, y: number) {
    this.lastX = x;
    this.lastY = y;
    if (this.ghost) this.ghost.style.transform = `translate(${x - this.offsetX}px, ${y - this.offsetY}px) rotate(1.5deg)`;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const target = el?.closest<HTMLElement>("[data-drop]") ?? null;
    if (target !== this.target) {
      this.target?.removeClass("is-drop-target");
      this.target = target;
      target?.addClass("is-drop-target");
    }
    if (!target || !target.hasAttribute("data-drop-list")) {
      this.placeholder.remove();
      this.beforeId = null;
      return;
    }
    const cards = Array.from(target.querySelectorAll<HTMLElement>(".wp-card[data-id]")).filter(
      (c) => c !== this.card && !c.hasClass("is-done"),
    );
    let before: HTMLElement | null = null;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        before = c;
        break;
      }
    }
    this.beforeId = before?.dataset.id ?? null;
    const anchor = before ?? target.querySelector<HTMLElement>(".wp-card.is-done") ?? target.querySelector<HTMLElement>(".wp-list-end");
    if (anchor) anchor.before(this.placeholder);
    else target.appendChild(this.placeholder);
  }

  private autoScroll() {
    const el = document.elementFromPoint(this.lastX, this.lastY) as HTMLElement | null;
    const edge = 40;
    // vertical: the list under the pointer
    const list = el?.closest<HTMLElement>(".wp-scroll-y");
    if (list) {
      const r = list.getBoundingClientRect();
      if (this.lastY < r.top + edge) list.scrollTop -= 8;
      else if (this.lastY > r.bottom - edge) list.scrollTop += 8;
    }
    // horizontal: the week grid
    const grid = this.root.querySelector<HTMLElement>(".wp-scroll-x");
    if (grid) {
      const r = grid.getBoundingClientRect();
      if (this.lastX < r.left + edge) grid.scrollLeft -= 10;
      else if (this.lastX > r.right - edge) grid.scrollLeft += 10;
    }
  }

  private finish() {
    this.clearTimer();
    const mode = this.mode;
    if (mode === "drag") {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 50);
      const target = this.target?.dataset.drop;
      const id = this.id;
      const before = this.beforeId;
      this.cleanup();
      if (target) this.cb.onDrop(id, target, before);
      return;
    }
    if (mode === "swipe") {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 50);
      const dx = this.lastX - this.startX;
      const id = this.id;
      this.cleanup();
      if (dx > SWIPE_TRIGGER) this.cb.onSwipe?.(id, "right");
      else if (dx < -SWIPE_TRIGGER) this.cb.onSwipe?.(id, "left");
      return;
    }
    this.cleanup();
  }

  private cleanup() {
    this.clearTimer();
    if (this.scrollTimer) window.clearInterval(this.scrollTimer);
    this.scrollTimer = null;
    this.ghost?.remove();
    this.ghost = null;
    this.placeholder.remove();
    this.target?.removeClass("is-drop-target");
    this.target = null;
    if (this.card) {
      this.card.removeClass("is-dragging", "is-swiping", "swipe-left", "swipe-right");
      this.card.style.transform = "";
    }
    document.body.removeClass("wp-is-dragging");
    this.card = null;
    this.mode = "idle";
  }

  private clearTimer() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private onClickCapture = (e: MouseEvent) => {
    if (this.suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  private onContextMenu = (e: MouseEvent) => {
    // iOS fires contextmenu on long-press; it must not interrupt a drag.
    if (this.dragging) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}
