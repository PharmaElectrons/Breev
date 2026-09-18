import { describe, expect, it } from "vitest";

import { helpContent, tourCopy } from "./help-content";
import { helpMessages } from "./help-messages";
import type { ModuleId } from "./module-ids";
import { moduleImplemented } from "./navigation";
import { navigationMessages } from "./navigation-messages";
import { MODULES_WITHOUT_TOUR, tourSteps } from "./tour-steps";

const LOCALES = ["ar", "en"] as const;

const MODULE_IDS = Object.keys(
  navigationMessages.en.modules,
) as readonly ModuleId[];

describe("help content", () => {
  it("covers every module surface in both locales", () => {
    for (const locale of LOCALES) {
      for (const moduleId of MODULE_IDS) {
        expect(helpContent[locale][moduleId]).toBeDefined();
      }
    }
  });

  it("gives every implemented module a purpose and at least one task", () => {
    for (const locale of LOCALES) {
      for (const moduleId of MODULE_IDS) {
        if (!moduleImplemented(moduleId)) {
          continue;
        }
        const guide = helpContent[locale][moduleId];
        expect(guide.purpose).not.toBe("");
        expect(guide.tasks.length).toBeGreaterThan(0);
        for (const task of guide.tasks) {
          expect(task.title).not.toBe("");
          expect(task.steps.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("says nothing at all about a module Breev has not built", () => {
    // An unbuilt surface falls back to the honest copy navigation-messages.ts
    // already owns. Prose here would be a second place for it to drift, and a
    // guide that explains an absent screen misleads exactly as much as a tab
    // that pretends to work.
    for (const locale of LOCALES) {
      for (const moduleId of MODULE_IDS) {
        if (moduleImplemented(moduleId)) {
          continue;
        }
        expect(helpContent[locale][moduleId].purpose).toBe("");
        expect(helpContent[locale][moduleId].tasks).toHaveLength(0);
      }
    }
  });

  it("keeps Arabic and English task structure identical", () => {
    for (const moduleId of MODULE_IDS) {
      const arabic = helpContent.ar[moduleId];
      const english = helpContent.en[moduleId];
      expect(arabic.tasks.map((task) => task.id)).toEqual(
        english.tasks.map((task) => task.id),
      );
      for (const [index, task] of arabic.tasks.entries()) {
        expect(task.steps).toHaveLength(
          english.tasks[index]?.steps.length ?? 0,
        );
      }
    }
  });

  it("never claims a function-key shortcut", () => {
    // docs/workflows.md: Breev will not finalize function keys until the team
    // observes them with pharmacists, Windows, and certified scanners. None are
    // implemented, so no guide may teach one.
    const functionKey = /\bF(?:1[0-2]|[1-9])\b/;
    for (const locale of LOCALES) {
      for (const moduleId of MODULE_IDS) {
        const guide = helpContent[locale][moduleId];
        expect(guide.purpose).not.toMatch(functionKey);
        for (const task of guide.tasks) {
          expect(task.title).not.toMatch(functionKey);
          for (const step of task.steps) {
            expect(step).not.toMatch(functionKey);
          }
        }
      }
      for (const entry of Object.values(tourCopy[locale])) {
        expect(entry.title).not.toMatch(functionKey);
        expect(entry.body).not.toMatch(functionKey);
      }
    }
  });
});

describe("tour steps", () => {
  it("offers a tutorial only where a surface is implemented", () => {
    for (const moduleId of Object.keys(tourSteps) as readonly ModuleId[]) {
      expect(moduleImplemented(moduleId)).toBe(true);
    }
  });

  it("records a decision for every module exactly once", () => {
    // Either a module has a tutorial or its absence is explained. This is what
    // stops Sales being quietly forgotten once its surface merges, and stops a
    // future tab shipping with no decision recorded either way.
    const withTour = Object.keys(tourSteps);
    const withoutTour = Object.keys(MODULES_WITHOUT_TOUR);
    expect(withTour.filter((id) => withoutTour.includes(id))).toEqual([]);
    expect([...withTour, ...withoutTour].sort()).toEqual(
      [...MODULE_IDS].sort(),
    );
    for (const reason of Object.values(MODULES_WITHOUT_TOUR)) {
      expect(reason).not.toBe("");
    }
  });

  it("has tooltip copy for every step in both locales", () => {
    for (const steps of Object.values(tourSteps)) {
      for (const step of steps) {
        for (const locale of LOCALES) {
          const entry = tourCopy[locale][step.anchor];
          expect(entry, `${locale} copy for ${step.anchor}`).toBeDefined();
          expect(entry?.title).not.toBe("");
          expect(entry?.body).not.toBe("");
        }
      }
    }
  });

  it("keeps tutorials short enough to finish", () => {
    // A walkthrough a pharmacist abandons halfway has taught nothing.
    for (const steps of Object.values(tourSteps)) {
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.length).toBeLessThanOrEqual(6);
    }
  });
});

describe("help chrome", () => {
  it("translates every string in both locales", () => {
    for (const locale of LOCALES) {
      const copy = helpMessages[locale];
      expect(copy.helpButton).not.toBe("");
      expect(copy.close).not.toBe("");
      expect(copy.purposeHeading).not.toBe("");
      expect(copy.tasksHeading).not.toBe("");
      expect(copy.scrollGuide).not.toBe("");
      expect(copy.startTutorial).not.toBe("");
      expect(copy.restartTutorial).not.toBe("");
      expect(copy.noTutorial).not.toBe("");
      expect(copy.noTutorialUnavailableScreen).not.toBe("");
      expect(copy.next).not.toBe("");
      expect(copy.back).not.toBe("");
      expect(copy.done).not.toBe("");
      expect(copy.skip).not.toBe("");
      expect(copy.panelTitle("Inventory")).toContain("Inventory");
      expect(copy.tourLabel("Inventory")).toContain("Inventory");
      expect(copy.stepCounter(2, 3)).toContain("2");
      expect(copy.stepCounter(2, 3)).toContain("3");
    }
  });
});
