import type { Locale } from "./preferences";

interface HelpCopy {
  /** The header button, and the accessible name of the panel it opens. */
  readonly helpButton: string;
  readonly panelTitle: (moduleName: string) => string;
  readonly panelDescription: string;
  readonly close: string;
  readonly purposeHeading: string;
  readonly tasksHeading: string;
  /** Names the scrollable body so it can be reached and scrolled by keyboard. */
  readonly scrollGuide: string;
  readonly startTutorial: string;
  readonly restartTutorial: string;
  readonly tutorialCompleted: string;
  /** Shown where a tutorial would be, when the screen has no steps to show. */
  readonly noTutorial: string;
  readonly noTutorialUnavailableScreen: string;
  /** The tour itself. */
  readonly tourLabel: (moduleName: string) => string;
  readonly next: string;
  readonly back: string;
  readonly done: string;
  readonly skip: string;
  readonly closeTour: string;
  readonly stepCounter: (current: number, total: number) => string;
}

/**
 * Arabic follows the register already used across the message catalogues and
 * the client's own prototype vocabulary, so the guide reads like the rest of the
 * product rather than like a translation layered on top of it.
 */
export const helpMessages: Record<Locale, HelpCopy> = {
  ar: {
    helpButton: "الدليل",
    panelTitle: (moduleName) => `دليل ${moduleName}`,
    panelDescription:
      "شرح موجز لهذه الشاشة وللمهام التي تُنجز عليها. اضغط Escape للإغلاق.",
    close: "إغلاق",
    purposeHeading: "ما تفعله هذه الشاشة",
    tasksHeading: "المهام الشائعة",
    scrollGuide: "نص الدليل",
    startTutorial: "ابدأ الشرح التفاعلي",
    restartTutorial: "أعد الشرح التفاعلي",
    tutorialCompleted: "أكملت هذا الشرح من قبل.",
    noTutorial: "لا يوجد شرح تفاعلي لهذه الشاشة.",
    noTutorialUnavailableScreen:
      "لا يوجد شرح تفاعلي لأن هذه الشاشة لم تُبنَ بعد.",
    tourLabel: (moduleName) => `شرح تفاعلي: ${moduleName}`,
    next: "التالي",
    back: "السابق",
    done: "إنهاء",
    skip: "تخطٍّ",
    closeTour: "إغلاق الشرح",
    stepCounter: (current, total) => `الخطوة ${current} من ${total}`,
  },
  en: {
    helpButton: "Guide",
    panelTitle: (moduleName) => `${moduleName} guide`,
    panelDescription:
      "A short explanation of this screen and the tasks you carry out on it. Press Escape to close.",
    close: "Close",
    purposeHeading: "What this screen does",
    tasksHeading: "Common tasks",
    scrollGuide: "Guide text",
    startTutorial: "Start tutorial",
    restartTutorial: "Run the tutorial again",
    tutorialCompleted: "You have completed this tutorial.",
    noTutorial: "This screen has no tutorial.",
    noTutorialUnavailableScreen:
      "There is no tutorial because this screen is not built yet.",
    tourLabel: (moduleName) => `Tutorial: ${moduleName}`,
    next: "Next",
    back: "Back",
    done: "Finish",
    skip: "Skip",
    closeTour: "Close the tutorial",
    stepCounter: (current, total) => `Step ${current} of ${total}`,
  },
};
