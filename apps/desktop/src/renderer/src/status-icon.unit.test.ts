import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StartupState } from "./startup-state";
import { StatusIcon } from "./status-icon";

describe("StatusIcon", () => {
  it("renders ready state with checkmark icon, data-icon-state, and aria-hidden", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "ready" }),
    );

    expect(markup).toContain('class="status-icon"');
    expect(markup).toContain('data-icon-state="ready"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('<path d="m7 12 3 3 7-7"');
    expect(markup).not.toContain("<circle");
  });

  it("renders repair-required state with wrench icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "repair-required" }),
    );

    expect(markup).toContain('data-icon-state="repair-required"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(
      '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z"',
    );
  });

  it("renders incompatible-version state with version mismatch arrows icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "incompatible-version" }),
    );

    expect(markup).toContain('data-icon-state="incompatible-version"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<path d="M8 7h9l-2-2"');
    expect(markup).toContain('<path d="m17 17-9 0 2 2"');
    expect(markup).toContain('<path d="m17 7-2 2"');
    expect(markup).toContain('<path d="m8 17 2-2"');
  });

  it("renders main-unavailable state with unavailable server icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "main-unavailable" }),
    );

    expect(markup).toContain('data-icon-state="main-unavailable"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<path d="M6 8h12v8H6z"');
    expect(markup).toContain('<path d="m4 4 16 16"');
  });

  it("renders unpaired state with unpaired device icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "unpaired" }),
    );

    expect(markup).toContain('data-icon-state="unpaired"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<path d="M9 4v5"');
    expect(markup).toContain('<path d="M15 4v5"');
    expect(markup).toContain('<path d="M7 9h10v3a5 5 0 0 1-10 0Z"');
    expect(markup).toContain('<path d="M12 17v3"');
  });

  it("renders starting state with default spinner icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "starting" }),
    );

    expect(markup).toContain('data-icon-state="starting"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<circle cx="12" cy="12" r="8"');
    expect(markup).toContain('<path d="M12 8v4l3 2"');
  });

  it("renders connecting state with default spinner icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, { state: "connecting" }),
    );

    expect(markup).toContain('data-icon-state="connecting"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<circle cx="12" cy="12" r="8"');
    expect(markup).toContain('<path d="M12 8v4l3 2"');
  });

  it("renders checking / fallback state with default spinner icon", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusIcon, {
        state: "checking" as unknown as StartupState,
      }),
    );

    expect(markup).toContain('data-icon-state="checking"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<circle cx="12" cy="12" r="8"');
    expect(markup).toContain('<path d="M12 8v4l3 2"');
  });

  it.each([
    ["ready", "m7 12 3 3 7-7"],
    [
      "repair-required",
      "M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z",
    ],
    ["incompatible-version", "M8 7h9l-2-2"],
    ["main-unavailable", "M6 8h12v8H6z"],
    ["unpaired", "M7 9h10v3a5 5 0 0 1-10 0Z"],
    ["starting", "M12 8v4l3 2"],
    ["connecting", "M12 8v4l3 2"],
    ["checking", "M12 8v4l3 2"],
  ] as const)(
    "verifies data-icon-state='%s' and aria-hidden='true'",
    (state, expectedPathSnippet) => {
      const markup = renderToStaticMarkup(
        createElement(StatusIcon, {
          state: state as StartupState,
        }),
      );

      expect(markup).toContain(`data-icon-state="${state}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain(expectedPathSnippet);
    },
  );
});
