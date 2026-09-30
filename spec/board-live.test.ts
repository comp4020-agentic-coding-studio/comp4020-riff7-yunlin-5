import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, inject, it } from "vitest";

// The board updates in place (src/scripts/board-live.ts) instead of
// reloading. The inline script in src/pages/index.astro still owns the SSE
// connection: it hands every "this may be stale" signal to
// window.roomBoardLive when that module has installed it, and only reloads
// when it hasn't (spec/live-updates.test.ts covers that fallback, since jsdom
// never runs the page's module scripts). This covers the hand-off itself.
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 0;
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.readyState = 2;
  }
}

const baseUrl = inject("baseUrl");

describe("the board's live hand-off", () => {
  it("hands bookings for this date and reconnects to roomBoardLive, never reloading", async () => {
    FakeEventSource.instances.length = 0;
    const date = "2031-05-06";
    const html = await (await fetch(new URL(`/?date=${date}`, baseUrl))).text();

    let reloadCalls = 0;
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", (error) => {
      if (String(error.message).includes("navigation")) reloadCalls++;
    });

    const refreshes: string[] = [];
    const dom = new JSDOM(html, {
      url: new URL(`/?date=${date}`, baseUrl).href,
      runScripts: "dangerously",
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        const w = window as unknown as {
          EventSource: typeof FakeEventSource;
          roomBoardLive: { refresh(reason: string): void };
        };
        w.EventSource = FakeEventSource;
        w.roomBoardLive = { refresh: (reason) => refreshes.push(reason) };
      },
    });

    const source = FakeEventSource.instances[0];
    expect(source).toBeDefined();
    expect((dom.window as unknown as { roomBoardSource: unknown }).roomBoardSource).toBe(source);

    const booking = (forDate: string) =>
      source.dispatchEvent(new MessageEvent("booking", { data: JSON.stringify({ date: forDate }) }));

    source.dispatchEvent(new Event("open"));
    booking(date);
    booking("2031-05-07");
    source.dispatchEvent(new Event("open"));

    expect(refreshes, "a booking on another date is not this board's business").toEqual(["booking", "reconnect"]);
    expect(reloadCalls, "with the live module present nothing reloads").toBe(0);
  });

  it("server-renders a hidden live indicator carrying the next boundary, and the figure's date", async () => {
    const html = await (await fetch(new URL("/", baseUrl))).text();
    const { document } = new JSDOM(html).window;
    const indicator = document.querySelector<HTMLElement>(".board-live");
    expect(indicator, "the live indicator's placeholder").not.toBeNull();
    expect(indicator?.hidden, "hidden with scripts off, where the page is a snapshot").toBe(true);
    // Today always has a next boundary: a booking start/end, or midnight.
    expect(Number(indicator?.dataset.nextBoundary)).toBeGreaterThan(Date.now() - 60_000);
    expect(document.querySelector<HTMLElement>("figure.floor3d")?.dataset.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
