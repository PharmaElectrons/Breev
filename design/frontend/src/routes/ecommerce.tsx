import { createFileRoute } from "@tanstack/react-router";
import { Store, RefreshCw, ShoppingCart } from "lucide-react";
import { ModuleWorkspace } from "@/components/module-workspace";

export const Route = createFileRoute("/ecommerce")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "التكامل مع المتجر الالكتروني — Breef Pharmacy" },
      { name: "description", content: "مزامنة المخزون لحظياً واستقبال الطلبات من المتجر الالكتروني." },
      { property: "og:title", content: "التكامل مع المتجر الالكتروني — Breef Pharmacy" },
      { property: "og:description", content: "ربط المخزون والطلبات مع المتجر الالكتروني." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ModuleWorkspace
      title="التكامل مع المتجر الالكتروني"
      subtitle="ربط المخزون والأسعار مع المتجر الالكتروني واستقبال الطلبات الواردة داخل النظام مباشرة."
      features={[
        { icon: RefreshCw, title: "مزامنة المخزون لحظياً", desc: "تحديث الكميات والأسعار على المتجر فور أي حركة بيع أو شراء." },
        { icon: ShoppingCart, title: "استقبال الطلبات", desc: "تحويل الطلبات الالكترونية إلى فواتير بيع بضغطة واحدة." },
        { icon: Store, title: "إدارة العرض", desc: "تحديد المواد المعروضة على المتجر وصورها ووصفها." },
      ]}
    />
  ),
});
