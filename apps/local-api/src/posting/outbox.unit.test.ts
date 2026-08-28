import { describe, expect, it } from "vitest";

import {
  CURRENT_ENVELOPE_VERSIONS,
  POSTING_ENVELOPE_VERSIONS,
  POSTING_EVENT_TYPES,
  PostingEnvelopeVersionError,
  assertSupportedEnvelope,
  isKnownPostingEventType,
  isSupportedEnvelope,
} from "./outbox.js";

describe("posting outbox envelope rules", () => {
  it("publishes the event type names domain readers depend on", () => {
    expect(POSTING_EVENT_TYPES).toEqual({
      pharmacySettingsChanged: "pharmacy.settings.changed",
    });
  });

  it("registers exactly the envelope versions that exist today", () => {
    expect(POSTING_ENVELOPE_VERSIONS).toEqual({
      "pharmacy.settings.changed": [1],
    });
    expect(CURRENT_ENVELOPE_VERSIONS).toEqual({
      "pharmacy.settings.changed": 1,
    });
  });

  it("registers the current version of every known event type", () => {
    for (const eventType of Object.keys(CURRENT_ENVELOPE_VERSIONS)) {
      expect(isKnownPostingEventType(eventType)).toBe(true);
      expect(
        isSupportedEnvelope(
          eventType,
          CURRENT_ENVELOPE_VERSIONS[
            eventType as keyof typeof CURRENT_ENVELOPE_VERSIONS
          ],
        ),
      ).toBe(true);
    }
  });

  it("accepts the registered envelope of a known event", () => {
    expect(
      isSupportedEnvelope(POSTING_EVENT_TYPES.pharmacySettingsChanged, 1),
    ).toBe(true);
    expect(() =>
      assertSupportedEnvelope(POSTING_EVENT_TYPES.pharmacySettingsChanged, 1),
    ).not.toThrow();
  });

  it.each([
    {
      label: "a future version",
      eventType: "pharmacy.settings.changed",
      version: 2,
    },
    {
      label: "a zero version",
      eventType: "pharmacy.settings.changed",
      version: 0,
    },
    {
      label: "a negative version",
      eventType: "pharmacy.settings.changed",
      version: -1,
    },
    {
      label: "a fractional version",
      eventType: "pharmacy.settings.changed",
      version: 1.5,
    },
    {
      label: "an unknown event type",
      eventType: "purchase.posted",
      version: 1,
    },
    { label: "a prototype key", eventType: "toString", version: 1 },
  ])("rejects $label", ({ eventType, version }) => {
    expect(isSupportedEnvelope(eventType, version)).toBe(false);
    expect(() => {
      assertSupportedEnvelope(eventType, version);
    }).toThrow(PostingEnvelopeVersionError);
  });

  it("names the envelope it refused", () => {
    const error = new PostingEnvelopeVersionError("purchase.posted", 7);

    expect(error.eventType).toBe("purchase.posted");
    expect(error.envelopeVersion).toBe(7);
    expect(error.message).toContain("purchase.posted");
    expect(error.message).toContain("7");
  });
});
