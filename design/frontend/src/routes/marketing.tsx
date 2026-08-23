import { createFileRoute } from "@tanstack/react-router";
import { Megaphone, Send, Percent } from "lucide-react";
import { ModuleWorkspace } from "@/components/module-workspace";

export const Route = createFileRoute("/marketing")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الترويج والتسويق — Breef Pharmacy" },
      { name: "description", content: "الحملات الترويجية وإرسال الرسائل الجماعية للمرضى عبر SMS وواتساب." },
      { property: "og:title", content: "الترويج والتسويق — Breef Pharmacy" },
      { property: "og:description", content: "حملات ترويجية ورسائل جماعية للمرضى." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ModuleWorkspace
      title="الترويج والتسويق"
      subtitle="إطلاق الحملات الترويجية وإدارة الرسائل الجماعية للمرضى عبر SMS وواتساب."
      features={[
        { icon: Percent, title: "الحملات الترويجية", desc: "إنشاء عروض وخصومات موقوتة على مواد أو فئات محددة." },
        { icon: Send, title: "رسائل جماعية", desc: "إرسال إشعارات SMS/واتساب لشرائح المرضى المستهدفة." },
        { icon: Megaphone, title: "قياس النتائج", desc: "متابعة أثر كل حملة على المبيعات وعدد الزيارات." },
      ]}
    />
  ),
});
