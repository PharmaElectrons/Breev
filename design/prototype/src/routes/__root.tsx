import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider } from "../lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "شاشة البيع — Breef Pharmacy" },
      {
        name: "description",
        content:
          "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة.",
      },
      { property: "og:title", content: "شاشة البيع — Breef Pharmacy" },
      {
        property: "og:description",
        content: "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "شاشة البيع — Breef Pharmacy" },
      { name: "description", content: "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة." },
      { property: "og:description", content: "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة." },
      { name: "twitter:description", content: "نقطة بيع الصيدلية مع حفظ الفواتير وإدارة الأدوية المزمنة." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5d8754d0-4748-49f8-bdcf-64e7d17da299/id-preview-76ed6bda--dffb05c3-5309-4f34-84f1-a8b9a3523cb8.lovable.app-1782999724411.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5d8754d0-4748-49f8-bdcf-64e7d17da299/id-preview-76ed6bda--dffb05c3-5309-4f34-84f1-a8b9a3523cb8.lovable.app-1782999724411.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AuthGate>
          <Outlet />
        </AuthGate>
        <Toaster position="top-center" richColors theme="dark" dir="rtl" />
      </I18nProvider>
    </QueryClientProvider>
  );
}

const DUMMY_EMAIL = "admin@breef.local";
const DUMMY_PASSWORD = "BreefAdmin!2024";

function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    const ensureSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          if (mounted) setReady(true);
          return;
        }
        const signIn = await supabase.auth.signInWithPassword({
          email: DUMMY_EMAIL,
          password: DUMMY_PASSWORD,
        });
        if (!signIn.error) {
          if (mounted) setReady(true);
          return;
        }
        await supabase.auth.signUp({
          email: DUMMY_EMAIL,
          password: DUMMY_PASSWORD,
        });
        await supabase.auth.signInWithPassword({
          email: DUMMY_EMAIL,
          password: DUMMY_PASSWORD,
        });
      } catch (err) {
        console.warn("Supabase auth skipped in demo mode:", err);
      } finally {
        if (mounted) setReady(true);
      }
    };
    ensureSession();
    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}

