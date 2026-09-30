// Reuse the existing forms and lists in a dedicated column beside the map.
const sidebar = document.querySelector<HTMLElement>(".board-sidebar");
const panels = [...document.querySelectorAll<HTMLElement>("[data-board-panel]")];
const links = [...document.querySelectorAll<HTMLAnchorElement>(".board-tabs a")];
const aliases: Record<string, string> = { floor: "room-details", top: "room-details", book: "book", rooms: "rooms", "my-week": "my-week", "room-details": "room-details" };

export function showBoardPanel(name: string, focus = false): void {
  if (!sidebar || !panels.some((panel) => panel.dataset.boardPanel === name)) return;
  for (const panel of panels) panel.hidden = panel.dataset.boardPanel !== name;
  for (const link of links) {
    if (link.hash === `#${name}`) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  for (const card of sidebar.querySelectorAll<HTMLElement>("[popover]:popover-open")) card.hidePopover();
  history.replaceState(history.state, "", `${location.pathname}${location.search}#${name}`);
  const scroll = sidebar.querySelector(".board-sidebar-content");
  if (scroll) scroll.scrollTop = 0;
  if (focus) {
    const panel = panels.find((panel) => !panel.hidden)!;
    const target = panel.querySelector<HTMLElement>("h2, h3, input, button");
    if (target) {
      if (!target.matches("input, button")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    if (matchMedia("(max-width: 900px)").matches) sidebar.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function panelFromLocation(): string {
  const hash = location.hash.slice(1);
  if (hash.startsWith("slot-") || new URLSearchParams(location.search).has("cancelError") && hash !== "my-week") return "rooms";
  return aliases[hash] ?? (new URLSearchParams(location.search).has("error") ? "book" : "room-details");
}

function positionCard(card: HTMLElement): void {
  if (!sidebar) return;
  const bounds = sidebar.getBoundingClientRect();
  const top = Math.max(12, bounds.top + 64);
  card.style.left = `${bounds.left + 12}px`;
  card.style.top = `${top}px`;
  card.style.width = `${bounds.width - 24}px`;
  card.style.maxHeight = `${Math.max(100, Math.min(bounds.bottom - 12, innerHeight - 12) - top)}px`;
}

if (sidebar) {
  showBoardPanel(panelFromLocation());
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    const name = link && aliases[link.hash.slice(1)];
    if (!name) return;
    event.preventDefault();
    showBoardPanel(name, true);
  });
  window.addEventListener("hashchange", () => showBoardPanel(panelFromLocation()));
  // Keep native popovers (including newly streamed bookings) entirely beside the map.
  document.addEventListener("beforetoggle", (event) => {
    const card = event.target;
    if (!(card instanceof HTMLElement) || !sidebar.contains(card) || !card.hasAttribute("popover")) return;
    if ((event as ToggleEvent).newState === "open") positionCard(card);
  }, true);
  const reposition = () => {
    for (const card of sidebar.querySelectorAll<HTMLElement>("[popover]:popover-open")) positionCard(card);
  };
  new ResizeObserver(reposition).observe(sidebar);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, { passive: true });
  const cancelError = new URLSearchParams(location.search).get("cancelError");
  if (cancelError && /^\d+$/.test(cancelError)) {
    const id = panelFromLocation() === "my-week" ? `booking-${cancelError}` : `cancel-${cancelError}`;
    document.getElementById(id)?.showPopover();
  }
}
