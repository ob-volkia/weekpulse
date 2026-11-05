// Pointer-based drag & drop that works the same with a mouse and on iOS touch,
// where HTML5 drag events are unreliable.
//   mouse: drag starts after moving 5px
//   touch: long-press (280ms) starts a drag; a quick horizontal swipe triggers onSwipe
//   Apple Pencil: drags at once (no long-press); a horizontal stroke across a card strikes it out
//   (onStrike); a vertical stroke on an empty timeline column draws a time block (onDrawBlock).
//   A mouse can draw time blocks too.
// Drop targets: elements with [data-drop]. A target with [data-drop-list] gets a placeholder
// between its .wp-card children; others (day pills on mobile) just highlight.

export interface DropInfo {
  el: HTMLElement; // the [data-drop] element
  top: number; // client Y of the dragged card's top edge
}

export interface DragCallbacks {
  onDrop(id: string, target: string, beforeId: string | null, info: DropInfo): void;
  onSwipe?(id: string, dir: "left" | "right"): void;
  /** Called while hovering a drop target, e.g. to show a time indicator on the timeline. */
  onHover?(el: HTMLElement | null, top: number): void;
  /** A pen stroke crossed the card out. */
  onStrike?(id: string): void;
  /** Preview of a block being drawn on a [data-drop-time] column: position inside the column and a label. */
  drawRange?(el: HTMLElement, y1: number, y2: number): { top: number; height: number; label: string } | null;
  /** A block was drawn from client Y y1 to y2. */
  onDrawBlock?(el: HTMLElement, y1: number, y2: number): void;
}

const LONG_PRESS = 280;
const SWIPE_TRIGGER = 80;
const STRIKE_MIN = 0.55; // share of the card width a strike must cover

/** Apple Pencil touches report touchType "stylus" in WebKit. */
function isStylus(t: Touch) {
  return (t as Touch & { touchType?: string }).touchType === "stylus";
}

export class DragController {
  private card: HTMLElement | null = null;
  private id = "";
  private startX = 0;
  private startY = 0;
  private mode: "idle" | "pending" | "drag" | "swipe" | "strike" | "draw" = "idle";
  private pen = false;
  private lastPointerPen = false;
  private ink: { svg: SVGSVGElement; line: SVGPolylineElement; points: [number, number][] } | null = null;
  private drawCol: HTMLElement | null = null;
  private drawPreview: HTMLElement | null = null;
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
    root.addEventListener("pointerdown", this.onPointerDown, true);
    root.addEventListener("mousedown", this.onMouseDown);
    root.addEventListener("touchstart", this.onTouchStart, { passive: true });
    root.addEventListener("click", this.onClickCapture, true);
    root.addEventListener("contextmenu", this.onContextMenu, true);
  }

  destroy() {
    this.root.removeEventListener("pointerdown", this.onPointerDown, true);
    this.root.removeEventListener("mousedown", this.onMouseDown);
    this.root.removeEventListener("touchstart", this.onTouchStart);
    this.root.removeEventListener("click", this.onClickCapture, true);
    this.root.removeEventListener("contextmenu", this.onContextMenu, true);
    this.cleanup();
  }

  get dragging() {
    return this.mode !== "idle" && this.mode !== "pending";
  }

  private onPointerDown = (e: PointerEvent) => {
    this.lastPointerPen = e.pointerType === "pen";
  };

  /** An empty spot of a timeline column, where a block can be drawn. */
  private drawTarget(e: Event): HTMLElement | null {
    if (!this.cb.onDrawBlock) return null;
    const el = e.target as HTMLElement;
    if (el.closest(".wp-card, .wp-event, input, button, a")) return null;
    return el.closest<HTMLElement>("[data-drop-time]");
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
    if (!card) {
      const col = this.drawTarget(e);
      if (!col) return;
      e.preventDefault();
      this.beginDraw(col, e.clientX, e.clientY);
      document.addEventListener("mousemove", this.onMouseMove);
      document.addEventListener("mouseup", this.onMouseUp);
      return;
    }
    this.begin(card, e.clientX, e.clientY);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.mode === "draw") return this.moveDraw(e.clientY);
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
    const t = e.touches[0];
    const pen = isStylus(t) || this.lastPointerPen;
    const card = this.cardFrom(e);
    if (!card) {
      // Pencil on an empty timeline column draws a block; a finger keeps scrolling.
      const col = pen ? this.drawTarget(e) : null;
      if (!col) return;
      this.beginDraw(col, t.clientX, t.clientY);
      this.addTouchListeners();
      return;
    }
    this.begin(card, t.clientX, t.clientY);
    this.pen = pen;
    if (!pen)
      this.timer = window.setTimeout(() => {
        if (this.mode === "pending") {
          navigator.vibrate?.(15);
          this.startDrag();
        }
      }, LONG_PRESS);
    this.addTouchListeners();
  };
  private addTouchListeners() {
    document.addEventListener("touchmove", this.onTouchMove, { passive: false });
    document.addEventListener("touchend", this.onTouchEnd);
    document.addEventListener("touchcancel", this.onTouchEnd);
  }
  private onTouchMove = (e: TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    if (this.mode === "draw") {
      e.preventDefault();
      return this.moveDraw(t.clientY);
    }
    if (this.mode === "pending" && this.pen) {
      e.preventDefault(); // the pencil never scrolls the list it is touching
      if (Math.hypot(dx, dy) > 6) {
        // Mostly sideways: start inking a strike; anything else: drag right away.
        if (this.cb.onStrike && Math.abs(dx) > Math.abs(dy) * 2) this.startInk();
        else this.startDrag();
      }
    }
    if (this.mode === "strike") {
      e.preventDefault();
      const r = this.card!.getBoundingClientRect();
      const out = t.clientX < r.left - 12 || t.clientX > r.right + 12 || t.clientY < r.top - 16 || t.clientY > r.bottom + 16;
      if (out) {
        // Left the card: it was a drag after all.
        this.removeInk();
        this.startDrag();
      } else {
        this.addInk(t.clientX, t.clientY);
        this.lastX = t.clientX;
        this.lastY = t.clientY;
        return;
      }
    }
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
    this.cb.onHover?.(target, y - this.offsetY);
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
    if (mode === "strike") {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 50);
      const pts = this.ink?.points ?? [];
      const r = this.card!.getBoundingClientRect();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
      const rise = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
      const id = this.id;
      const struck = span >= r.width * STRIKE_MIN && rise <= Math.max(28, r.height * 0.6);
      this.cleanup();
      if (struck) this.cb.onStrike?.(id);
      return;
    }
    if (mode === "draw") {
      const col = this.drawCol!;
      const y1 = this.startY;
      const y2 = this.lastY;
      this.cleanup();
      if (Math.abs(y2 - y1) >= 8) this.cb.onDrawBlock?.(col, Math.min(y1, y2), Math.max(y1, y2));
      return;
    }
    if (mode === "drag") {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 50);
      const el = this.target;
      const target = el?.dataset.drop;
      const id = this.id;
      const before = this.beforeId;
      const top = this.lastY - this.offsetY;
      this.cleanup();
      if (el && target) this.cb.onDrop(id, target, before, { el, top });
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
    this.removeInk();
    this.drawPreview?.remove();
    this.drawPreview = null;
    this.drawCol = null;
    this.pen = false;
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
    if (this.mode === "drag") this.cb.onHover?.(null, 0);
    this.card = null;
    this.mode = "idle";
  }

  // ----- pencil strike -----
  private startInk() {
    this.mode = "strike";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wp-ink");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    svg.appendChild(line);
    document.body.appendChild(svg);
    this.ink = { svg, line, points: [[this.startX, this.startY]] };
    this.card?.addClass("is-striking");
  }

  private addInk(x: number, y: number) {
    if (!this.ink) return;
    this.ink.points.push([x, y]);
    this.ink.line.setAttribute("points", this.ink.points.map((p) => p.join(",")).join(" "));
  }

  private removeInk() {
    this.ink?.svg.remove();
    this.ink = null;
    this.card?.removeClass("is-striking");
  }

  // ----- drawing a time block -----
  private beginDraw(col: HTMLElement, x: number, y: number) {
    this.mode = "draw";
    this.drawCol = col;
    this.startX = this.lastX = x;
    this.startY = this.lastY = y;
    this.drawPreview = col.createDiv({ cls: "wp-draw-block" });
    this.moveDraw(y);
  }

  private moveDraw(y: number) {
    this.lastY = y;
    if (!this.drawCol || !this.drawPreview) return;
    const r = this.cb.drawRange?.(this.drawCol, Math.min(this.startY, y), Math.max(this.startY, y));
    if (!r) return;
    this.drawPreview.style.top = `${r.top}px`;
    this.drawPreview.style.height = `${r.height}px`;
    this.drawPreview.setText(r.label);
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
