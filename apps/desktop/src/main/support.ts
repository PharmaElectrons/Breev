import type { DesktopOpenSupportRequest } from "@breev/contracts/desktop-preload";

export interface SupportConfiguration {
  readonly email?: string;
  readonly portalUrl?: string;
}

export function readSupportConfiguration(
  environment: NodeJS.ProcessEnv,
): SupportConfiguration {
  const email = parseSupportEmail(environment.BREEV_SUPPORT_EMAIL);
  const portalUrl = parseSupportPortal(environment.BREEV_SUPPORT_PORTAL_URL);
  return {
    ...(email === undefined ? {} : { email }),
    ...(portalUrl === undefined ? {} : { portalUrl }),
  };
}

export function createSupportDestination(
  configuration: SupportConfiguration,
  request: DesktopOpenSupportRequest,
  metadata: {
    readonly appVersion: string;
    readonly architecture: string;
    readonly platform: string;
  },
): { readonly channel: "email" | "portal"; readonly url: string } | undefined {
  const reference = request.incidentCode ?? "not-provided";
  if (configuration.email !== undefined) {
    const parameters = new URLSearchParams({
      body:
        request.locale === "ar"
          ? `مرجع الخطأ: ${reference}\nإصدار Breev: ${metadata.appVersion}\nالنظام: ${metadata.platform}/${metadata.architecture}\n\nيرجى إرفاق حزمة التشخيص المصدرة بهذه الرسالة.`
          : `Error reference: ${reference}\nBreev version: ${metadata.appVersion}\nSystem: ${metadata.platform}/${metadata.architecture}\n\nPlease attach the exported diagnostic package to this message.`,
      subject: `Breev support - ${reference}`,
    });
    return {
      channel: "email",
      url: `mailto:${configuration.email}?${parameters.toString()}`,
    };
  }
  if (configuration.portalUrl !== undefined) {
    const destination = new URL(configuration.portalUrl);
    destination.searchParams.set("reference", reference);
    destination.searchParams.set("version", metadata.appVersion);
    return { channel: "portal", url: destination.toString() };
  }
  return undefined;
}

function parseSupportEmail(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const candidate = value.trim();
  if (
    candidate.length > 254 ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu.test(
      candidate,
    )
  ) {
    return undefined;
  }
  return candidate;
}

function parseSupportPortal(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  try {
    const candidate = new URL(value.trim());
    if (
      candidate.protocol !== "https:" ||
      candidate.username !== "" ||
      candidate.password !== "" ||
      candidate.hash !== "" ||
      candidate.toString().length > 2_048
    ) {
      return undefined;
    }
    return candidate.toString();
  } catch {
    return undefined;
  }
}
