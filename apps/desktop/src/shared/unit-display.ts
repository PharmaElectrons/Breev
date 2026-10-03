type Locale = "ar" | "en";

// Approved report vocabulary, matched as complete names. Application text stays verbatim.
const units: Readonly<Record<string, string>> = {
  pack: "علبة",
  packs: "علبة",
  box: "علبة",
  boxes: "علبة",
  strip: "شريط",
  strips: "شريط",
  bottle: "زجاجة",
  bottles: "زجاجة",
  tablet: "قرص",
  tablets: "قرص",
  capsule: "كبسولة",
  capsules: "كبسولة",
  ampoule: "أمبولة",
  ampoules: "أمبولة",
  vial: "قارورة",
  vials: "قارورة",
  tube: "أنبوب",
  tubes: "أنبوب",
  piece: "قطعة",
  pieces: "قطعة",
  sachet: "كيس",
  sachets: "كيس",
  unit: "وحدة",
  units: "وحدة",
};

export function unitDisplayName(name: string, locale: Locale): string {
  return locale === "ar" ? (units[name.trim().toLowerCase()] ?? name) : name;
}

export function countUnitLabel(
  name: string,
  count: bigint,
  locale: Locale,
): string {
  if (locale !== "ar") return name;
  const key = name.trim().toLowerCase();
  const pack = ["pack", "packs", "علبة", "علب", "علبتان", "علبتين"].includes(
    key,
  );
  const strip = [
    "strip",
    "strips",
    "شريط",
    "أشرطة",
    "اشرطة",
    "شريطان",
    "شريطين",
  ].includes(key);
  if (!pack && !strip) return unitDisplayName(name, locale);
  const value = count < 0n ? -count : count;
  if (value === 2n) return pack ? "علبتان" : "شريطان";
  if (value % 100n >= 3n && value % 100n <= 10n) return pack ? "علب" : "أشرطة";
  return pack ? "علبة" : "شريط";
}
