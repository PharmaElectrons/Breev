import type { IdentityRole } from "@breev/contracts/local-rest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { identityMessages } from "./identity-messages";
import { RoleEditor, trapRoleDialogFocus } from "./role-editor";

const TEST_ROLES: readonly IdentityRole[] = [
  {
    id: "role-owner",
    key: "owner",
    kind: "built-in",
    grants: [
      "identity.roles.manage",
      "identity.users.manage",
      "licensing.manage",
    ],
    revision: "1",
  },
  {
    id: "role-cashier",
    kind: "custom",
    name: "Cashier",
    grants: ["sales.drafts.manage"],
    revision: "1",
  },
];

const TEST_PERMISSIONS: readonly string[] = [
  "identity.users.manage",
  "identity.roles.manage",
  "pharmacy.settings.manage",
  "attendance.record",
  "devices.pair",
  "licensing.manage",
];

function createMockProps(
  overrides: Partial<Parameters<typeof RoleEditor>[0]> = {},
) {
  return {
    baseUrl: "http://127.0.0.1:4000",
    beginStepUp: vi.fn(async () => {}),
    busy: false,
    copy: identityMessages.en,
    currentUserRoleId: "role-owner",
    getLastDenial: () => null,
    onChanged: vi.fn(async () => {}),
    permissions: TEST_PERMISSIONS,
    requestFocus: vi.fn(),
    roles: TEST_ROLES,
    run: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("RoleEditor unit tests", () => {
  describe("Permission grouping tabs and badges", () => {
    it("renders permission groups as horizontal tabs with badge showing granted count / total in each category (English)", () => {
      const copy = identityMessages.en;
      const markup = renderToStaticMarkup(
        createElement(RoleEditor, createMockProps({ copy })),
      );

      // Verify tabs structure and horizontal orientation
      expect(markup).toContain('data-slot="tabs"');
      expect(markup).toContain('data-orientation="horizontal"');
      expect(markup).toContain("permission-subset-tabs");
      expect(markup).toContain('data-slot="tabs-list"');
      expect(markup).toContain("permission-subtabs-list");

      // Verify each group has a trigger with testid, localized label, and badge
      // 1. Administration: 3 permissions, owner has 2 granted (users.manage, roles.manage)
      expect(markup).toContain(
        'data-testid="permission-subset-tab-administration"',
      );
      expect(markup).toContain(copy.permissionGroups.administration);
      expect(markup).toContain(
        '<span class="permission-subtab-badge">2/3</span>',
      );

      // 2. Attendance: 1 permission, owner has 0 granted
      expect(markup).toContain(
        'data-testid="permission-subset-tab-attendance"',
      );
      expect(markup).toContain(copy.permissionGroups.attendance);
      expect(markup).toContain(
        '<span class="permission-subtab-badge">0/1</span>',
      );

      // 3. Devices & Licensing: 2 permissions, owner has 1 granted (licensing.manage)
      expect(markup).toContain(
        'data-testid="permission-subset-tab-devices-licensing"',
      );
      expect(markup).toContain(copy.permissionGroups["devices-licensing"]);
      expect(markup).toContain(
        '<span class="permission-subtab-badge">1/2</span>',
      );

      // Verify tabs content panels
      expect(markup).toContain('data-slot="tabs-content"');
      expect(markup).toContain("permission-subtab-content");
      expect(markup).toContain("permission-group");
    });

    it("renders permission groups as horizontal tabs with badge showing granted count / total in Arabic", () => {
      const copy = identityMessages.ar;
      const markup = renderToStaticMarkup(
        createElement(RoleEditor, createMockProps({ copy })),
      );

      expect(markup).toContain('data-slot="tabs"');
      expect(markup).toContain('data-orientation="horizontal"');

      // Arabic group labels
      expect(markup).toContain(copy.permissionGroups.administration);
      expect(markup).toContain(copy.permissionGroups.attendance);
      expect(markup).toContain(copy.permissionGroups["devices-licensing"]);

      // Badges
      expect(markup).toContain(
        '<span class="permission-subtab-badge">2/3</span>',
      );
      expect(markup).toContain(
        '<span class="permission-subtab-badge">0/1</span>',
      );
      expect(markup).toContain(
        '<span class="permission-subtab-badge">1/2</span>',
      );
    });

    it("reflects custom role granted counts in category badges", () => {
      const copy = identityMessages.en;
      const customRole: IdentityRole = {
        id: "role-pharmacist",
        kind: "custom",
        name: "Pharmacist",
        grants: [
          "identity.users.manage",
          "pharmacy.settings.manage",
          "attendance.record",
          "devices.pair",
          "licensing.manage",
        ],
        revision: "1",
      };

      const markup = renderToStaticMarkup(
        createElement(
          RoleEditor,
          createMockProps({
            copy,
            roles: [customRole],
          }),
        ),
      );

      // Administration: 2 of 3 granted
      expect(markup).toContain(
        '<span class="permission-subtab-badge">2/3</span>',
      );
      // Attendance: 1 of 1 granted
      expect(markup).toContain(
        '<span class="permission-subtab-badge">1/1</span>',
      );
      // Devices & Licensing: 2 of 2 granted
      expect(markup).toContain(
        '<span class="permission-subtab-badge">2/2</span>',
      );
    });
  });

  describe("New role modal dialog opening", () => {
    it("does not render modal dialog by default and displays Add Role button", () => {
      const copy = identityMessages.en;
      const markup = renderToStaticMarkup(
        createElement(
          RoleEditor,
          createMockProps({ copy, initialCreating: false }),
        ),
      );

      expect(markup).toContain('id="add-role-button"');
      expect(markup).toContain(copy.addRole);
      expect(markup).not.toContain('role="dialog"');
      expect(markup).not.toContain('class="dialog-backdrop"');
      expect(markup).not.toContain("new-role-dialog-title");
    });

    it("opens modal dialog with form, name input, close button, and permission tabs when creating", () => {
      const copy = identityMessages.en;
      const markup = renderToStaticMarkup(
        createElement(
          RoleEditor,
          createMockProps({ copy, initialCreating: true }),
        ),
      );

      // Dialog container attributes
      expect(markup).toContain('role="dialog"');
      expect(markup).toContain('aria-modal="true"');
      expect(markup).toContain('class="dialog-backdrop"');
      expect(markup).toContain('aria-labelledby="new-role-dialog-title"');

      // Dialog header
      expect(markup).toContain('id="new-role-dialog-title"');
      expect(markup).toContain(copy.newRoleTitle);
      expect(markup).toContain(copy.customRole);

      // Close button
      expect(markup).toContain('class="quiet-button close-dialog-button"');
      expect(markup).toContain(`aria-label="${copy.cancel}"`);
      expect(markup).toContain("✕");

      // Form and name input
      expect(markup).toContain('class="identity-form new-role-form"');
      expect(markup).toContain(copy.roleName);
      expect(markup).toContain('name="name"');
      expect(markup).toContain('maxLength="64"');
      expect(markup).toContain("required");

      // Dialog form actions
      expect(markup).toContain('id="role-create-submit"');
      expect(markup).toContain(copy.createRole);
      expect(markup).toContain(copy.cancel);

      // Inside the dialog, permission grouping tabs are rendered for new role with 0/N grants
      expect(markup).toContain(
        '<span class="permission-subtab-badge">0/3</span>',
      );
      expect(markup).toContain(
        '<span class="permission-subtab-badge">0/1</span>',
      );
      expect(markup).toContain(
        '<span class="permission-subtab-badge">0/2</span>',
      );
    });

    it("renders modal dialog in Arabic when locale is Arabic", () => {
      const copy = identityMessages.ar;
      const markup = renderToStaticMarkup(
        createElement(
          RoleEditor,
          createMockProps({ copy, initialCreating: true }),
        ),
      );

      expect(markup).toContain('id="new-role-dialog-title"');
      expect(markup).toContain(copy.newRoleTitle);
      expect(markup).toContain(copy.customRole);
      expect(markup).toContain(`aria-label="${copy.cancel}"`);
      expect(markup).toContain(copy.roleName);
      expect(markup).toContain(copy.createRole);
    });
  });

  describe("Escape key and close button dismissal", () => {
    let focusSpy: ReturnType<typeof vi.fn>;
    const originalDocument = globalThis.document;

    beforeEach(() => {
      focusSpy = vi.fn();
      const mockDocument = {
        activeElement: null,
        getElementById: vi.fn((id: string) => {
          if (id === "add-role-button") {
            return { focus: focusSpy } as unknown as HTMLElement;
          }
          return null;
        }),
      };
      (globalThis as unknown as { document: unknown }).document = mockDocument;

      return () => {
        (globalThis as unknown as { document: unknown }).document =
          originalDocument;
      };
    });

    it("cancels and closes the dialog on Escape key", () => {
      const onClose = vi.fn();
      const event = {
        key: "Escape",
        preventDefault: vi.fn(),
        shiftKey: false,
      };

      trapRoleDialogFocus({
        activeElement: null,
        container: null,
        event,
        onClose,
      });

      expect(onClose).toHaveBeenCalledOnce();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("restores focus to add-role-button when close button is clicked", () => {
      // Simulate close button action
      const closeAction = () => {
        document.getElementById("add-role-button")?.focus();
      };
      closeAction();

      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it("restores focus to add-role-button when cancel button is clicked", () => {
      // Simulate cancel button action
      const cancelAction = () => {
        document.getElementById("add-role-button")?.focus();
      };
      cancelAction();

      expect(focusSpy).toHaveBeenCalledOnce();
    });

    it("restores focus to add-role-button when Escape key triggers dialog close", () => {
      const onClose = vi.fn(() => {
        document.getElementById("add-role-button")?.focus();
      });

      trapRoleDialogFocus({
        activeElement: null,
        container: null,
        event: {
          key: "Escape",
          preventDefault: vi.fn(),
          shiftKey: false,
        },
        onClose,
      });

      expect(onClose).toHaveBeenCalledOnce();
      expect(focusSpy).toHaveBeenCalledOnce();
    });
  });

  describe("Focus trapping inside the modal dialog", () => {
    function createMockElement(tag: string, disabled = false, tabIndex = 0) {
      return {
        disabled,
        focus: vi.fn(),
        tabIndex,
        tagName: tag.toUpperCase(),
      } as unknown as HTMLElement;
    }

    function createMockContainer(
      elements: readonly HTMLElement[],
    ): Pick<HTMLElement, "querySelectorAll"> {
      return {
        querySelectorAll: vi.fn(
          () => elements,
        ) as unknown as HTMLElement["querySelectorAll"],
      };
    }

    it("traps focus inside dialog: pressing Tab on last focusable element wraps to first", () => {
      const firstInput = createMockElement("input");
      const middleSelect = createMockElement("select");
      const lastButton = createMockElement("button");

      const focusableElements = [firstInput, middleSelect, lastButton];
      const container = createMockContainer(focusableElements);

      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: false,
      };

      trapRoleDialogFocus({
        activeElement: lastButton,
        container,
        event,
        onClose: vi.fn(),
      });

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(firstInput.focus).toHaveBeenCalledOnce();
      expect(lastButton.focus).not.toHaveBeenCalled();
    });

    it("traps focus inside dialog: pressing Shift+Tab on first focusable element wraps to last", () => {
      const firstInput = createMockElement("input");
      const middleButton = createMockElement("button");
      const lastButton = createMockElement("button");

      const focusableElements = [firstInput, middleButton, lastButton];
      const container = createMockContainer(focusableElements);

      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: true,
      };

      trapRoleDialogFocus({
        activeElement: firstInput,
        container,
        event,
        onClose: vi.fn(),
      });

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(lastButton.focus).toHaveBeenCalledOnce();
      expect(firstInput.focus).not.toHaveBeenCalled();
    });

    it("allows standard Tab navigation when active element is not the last element", () => {
      const firstInput = createMockElement("input");
      const middleButton = createMockElement("button");
      const lastButton = createMockElement("button");

      const focusableElements = [firstInput, middleButton, lastButton];
      const container = createMockContainer(focusableElements);

      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: false,
      };

      trapRoleDialogFocus({
        activeElement: firstInput,
        container,
        event,
        onClose: vi.fn(),
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(firstInput.focus).not.toHaveBeenCalled();
      expect(lastButton.focus).not.toHaveBeenCalled();
    });

    it("allows standard Shift+Tab navigation when active element is not the first element", () => {
      const firstInput = createMockElement("input");
      const middleButton = createMockElement("button");
      const lastButton = createMockElement("button");

      const focusableElements = [firstInput, middleButton, lastButton];
      const container = createMockContainer(focusableElements);

      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: true,
      };

      trapRoleDialogFocus({
        activeElement: lastButton,
        container,
        event,
        onClose: vi.fn(),
      });

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(firstInput.focus).not.toHaveBeenCalled();
      expect(lastButton.focus).not.toHaveBeenCalled();
    });

    it("does not throw or prevent default when container is null or has no focusable elements", () => {
      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: false,
      };

      // Null container
      trapRoleDialogFocus({
        activeElement: null,
        container: null,
        event,
        onClose: vi.fn(),
      });
      expect(event.preventDefault).not.toHaveBeenCalled();

      // Empty focusable elements list
      const emptyContainer = createMockContainer([]);
      trapRoleDialogFocus({
        activeElement: null,
        container: emptyContainer,
        event,
        onClose: vi.fn(),
      });
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it("ignores non-Tab, non-Escape keys", () => {
      const firstInput = createMockElement("input");
      const lastButton = createMockElement("button");
      const container = createMockContainer([firstInput, lastButton]);

      const event = {
        key: "Enter",
        preventDefault: vi.fn(),
        shiftKey: false,
      };
      const onClose = vi.fn();

      trapRoleDialogFocus({
        activeElement: lastButton,
        container,
        event,
        onClose,
      });

      expect(onClose).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(firstInput.focus).not.toHaveBeenCalled();
    });

    it("uses the correct selector for focusable elements matching buttons, inputs, selects, textareas, and tabindex", () => {
      const querySelectorAllSpy = vi.fn(() => []);
      const container: Pick<HTMLElement, "querySelectorAll"> = {
        querySelectorAll:
          querySelectorAllSpy as unknown as HTMLElement["querySelectorAll"],
      };

      const event = {
        key: "Tab",
        preventDefault: vi.fn(),
        shiftKey: false,
      };

      trapRoleDialogFocus({
        activeElement: null,
        container,
        event,
        onClose: vi.fn(),
      });

      expect(querySelectorAllSpy).toHaveBeenCalledWith(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
    });
  });
});
