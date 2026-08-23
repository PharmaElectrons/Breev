import { createFileRoute } from "@tanstack/react-router";
import { Truck, UserCheck, MapPin } from "lucide-react";
import { ModuleWorkspace } from "@/components/module-workspace";

export const Route = createFileRoute("/delivery")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "التوصيل — Breef Pharmacy" },
      { name: "description", content: "إدارة طلبات التوصيل، تعيين السائقين، وتتبع حالة الطلب." },
      { property: "og:title", content: "التوصيل — Breef Pharmacy" },
      { property: "og:description", content: "إرسال الطلبات وتعيين المندوبين وتتبع التوصيل." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ModuleWorkspace
      title="التوصيل"
      subtitle="لوحة إدارة التوصيل: توزيع الطلبات، تعيين السائقين، ومتابعة حالة كل طلبية لحظياً."
      features={[
        { icon: Truck, title: "إرسال الطلبات", desc: "تحويل فواتير البيع إلى طلبات توصيل جاهزة للإرسال." },
        { icon: UserCheck, title: "تعيين السائق", desc: "إسناد كل طلبية إلى مندوب توصيل مع سجل الأداء." },
        { icon: MapPin, title: "حالة التوصيل", desc: "تتبع الحالة: قيد التجهيز، بالطريق، تم التسليم، ملغى." },
      ]}
    />
  ),
});
