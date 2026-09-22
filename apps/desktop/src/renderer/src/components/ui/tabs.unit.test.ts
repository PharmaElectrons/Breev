import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("Tabs component", () => {
  it("renders tabs structure with correct data-slot attributes", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Tabs,
        { defaultValue: "password" },
        createElement(
          TabsList,
          null,
          createElement(TabsTrigger, { value: "password" }, "Password"),
          createElement(TabsTrigger, { value: "roles" }, "Roles"),
          createElement(TabsTrigger, { value: "licence" }, "Licence"),
        ),
        createElement(
          TabsContent,
          { value: "password" },
          "Password tab content",
        ),
        createElement(TabsContent, { value: "roles" }, "Roles tab content"),
        createElement(TabsContent, { value: "licence" }, "Licence tab content"),
      ),
    );

    expect(markup).toContain('data-slot="tabs"');
    expect(markup).toContain('data-slot="tabs-list"');
    expect(markup).toContain('data-slot="tabs-trigger"');
    expect(markup).toContain('data-slot="tabs-content"');
    expect(markup).toContain("Password");
    expect(markup).toContain("Roles");
    expect(markup).toContain("Licence");
    expect(markup).toContain("Password tab content");
  });

  it("renders with horizontal orientation by default", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Tabs,
        { defaultValue: "one" },
        createElement(
          TabsList,
          null,
          createElement(TabsTrigger, { value: "one" }, "One"),
        ),
        createElement(TabsContent, { value: "one" }, "One content"),
      ),
    );

    expect(markup).toContain('data-orientation="horizontal"');
  });
});
