const GAP = 16;

// Sticky offset for a sidebar with no scroll of its own: pinned to the top
// while it fits, pinned by its bottom edge once it is taller than the viewport.
export const stickyTop = (panelHeight: number, viewportHeight: number) =>
  Math.min(GAP, viewportHeight - panelHeight - GAP);

export function followPage(panel: HTMLElement) {
  const update = () => panel.style.setProperty('--panel-top', `${stickyTop(panel.offsetHeight, innerHeight)}px`);
  update();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  observer?.observe(panel);
  addEventListener('resize', update);
  return () => {
    observer?.disconnect();
    removeEventListener('resize', update);
  };
}
