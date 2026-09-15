import { describe, expect, it } from "vitest";

import {
  SALE_DRAFT_STATUSES,
  saleDraftCreateContract,
  saleDraftListContract,
  saleDraftListQuerySchema,
  saleDraftPath,
  saleDraftReadContract,
  saleDraftResumptionsPath,
  saleDraftResumeContract,
  saleDraftsPath,
} from "./index.js";

const DRAFT_ID = "0198e7ce-7685-7000-8000-000000000001";
const USER_ID = "0198e7ce-7685-7000-8000-000000000002";

const draft = {
  createdAt: "2026-09-12T10:00:00.000Z",
  createdBy: { displayName: "Owner", id: USER_ID },
  id: DRAFT_ID,
  status: "active",
  updatedAt: "2026-09-12T10:00:00.000Z",
  updatedBy: { displayName: "Owner", id: USER_ID },
  version: "1",
};

describe("sales contracts", () => {
  it("accepts the minimal create, resume, and list request shapes exactly", () => {
    expect(
      saleDraftCreateContract.request.body.parse({ idempotencyKey: USER_ID }),
    ).toEqual({ idempotencyKey: USER_ID });
    expect(
      saleDraftResumeContract.request.body.parse({
        expectedVersion: "1",
        idempotencyKey: USER_ID,
      }),
    ).toEqual({ expectedVersion: "1", idempotencyKey: USER_ID });
    expect(saleDraftListQuerySchema.parse({})).toEqual({});
    expect(saleDraftListQuerySchema.parse({ status: "active" })).toEqual({
      status: "active",
    });

    for (const request of [
      { idempotencyKey: USER_ID, extra: true },
      { idempotencyKey: "not-a-uuid" },
    ]) {
      expect(
        saleDraftCreateContract.request.body.safeParse(request).success,
      ).toBe(false);
    }
    expect(
      saleDraftResumeContract.request.body.safeParse({
        expectedVersion: "0",
        idempotencyKey: USER_ID,
      }).success,
    ).toBe(false);
    expect(saleDraftListQuerySchema.safeParse({ extra: true }).success).toBe(
      false,
    );
  });

  it("keeps the wire record minimal and rejects future sale scope", () => {
    expect(saleDraftCreateContract.responses[201].parse(draft)).toEqual(draft);
    expect(
      saleDraftReadContract.responses[200].safeParse({
        ...draft,
        patientId: USER_ID,
      }).success,
    ).toBe(false);
    expect(
      saleDraftListContract.responses[200].parse({ drafts: [draft] }),
    ).toEqual({ drafts: [draft] });
  });

  it("keeps sale statuses, paths, methods, and success statuses stable", () => {
    expect([...SALE_DRAFT_STATUSES]).toEqual(["active"]);
    expect(saleDraftsPath()).toBe("/sales/drafts");
    expect(saleDraftPath(DRAFT_ID)).toBe(`/sales/drafts/${DRAFT_ID}`);
    expect(saleDraftResumptionsPath(DRAFT_ID)).toBe(
      `/sales/drafts/${DRAFT_ID}/resumptions`,
    );
    expect(saleDraftListContract.method).toBe("GET");
    expect(saleDraftListContract.path).toBe("/sales/drafts");
    expect(saleDraftReadContract.method).toBe("GET");
    expect(saleDraftReadContract.path).toBe("/sales/drafts/:draftId");
    expect(saleDraftCreateContract.method).toBe("POST");
    expect(saleDraftCreateContract.path).toBe("/sales/drafts");
    expect(saleDraftResumeContract.method).toBe("POST");
    expect(saleDraftResumeContract.path).toBe(
      "/sales/drafts/:draftId/resumptions",
    );
    expect(Object.hasOwn(saleDraftCreateContract.responses, 201)).toBe(true);
    expect(Object.hasOwn(saleDraftResumeContract.responses, 200)).toBe(true);
  });
});
