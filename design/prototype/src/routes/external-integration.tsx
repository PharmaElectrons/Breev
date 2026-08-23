import { createFileRoute } from "@tanstack/react-router";
import { Webhook, Megaphone, Sheet } from "lucide-react";
import { ModuleWorkspace } from "@/components/module-workspace";

export const Route = createFileRoute("/external-integration")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الربط الخارجي — Breef Pharmacy" },
      { name: "description", content: "إدارة الويب هوك، واجهة إعلانات ميتا، وتسجيل البيانات في Google Sheets." },
      { property: "og:title", content: "الربط الخارجي — Breef Pharmacy" },
      { property: "og:description", content: "ربط الصيدلية بالخدمات الخارجية والأتمتة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ModuleWorkspace
      title="الربط الخارجي"
      subtitle="مركز الربط مع الخدمات الخارجية: الويب هوك، واجهات الإعلانات، وتسجيل الحركات في جداول البيانات."
      features={[
        { icon: Webhook, title: "Webhooks", desc: "استقبال وإرسال الأحداث اللحظية بين النظام والخدمات الخارجية." },
        { icon: Megaphone, title: "Meta Ads API", desc: "مزامنة الحملات الإعلانية وقياس نتائجها من داخل النظام." },
        { icon: Sheet, title: "Google Sheets Logging", desc: "تصدير حركات البيع والمخزون تلقائياً إلى جداول البيانات." },
      ]}
    />
  ),
});
