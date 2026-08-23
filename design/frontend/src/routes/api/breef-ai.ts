// Breef AI dashboard assistant — answers natural-language questions about pharmacy KPIs.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/breef-ai")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: { question?: string; context?: unknown };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const question = String(body?.question ?? "").trim();
        if (!question) return new Response("Question is required", { status: 400 });

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Lovable-API-Key": key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content:
                  "أنت Breef AI — مساعد ذكي لصيدلية Breef Pharmacy. أجب باللغة العربية بشكل موجز ومباشر (2-4 جمل كحد أقصى). استند إلى مؤشرات لوحة القيادة المزودة في رسالة المستخدم. جميع المبالغ بالدينار العراقي.",
              },
              {
                role: "user",
                content: `مؤشرات لوحة القيادة الحالية:\n${JSON.stringify(body.context ?? {}, null, 2)}\n\nالسؤال: ${question}`,
              },
            ],
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || `Upstream ${upstream.status}`, { status: upstream.status });
        }
        const data = await upstream.json();
        const answer = data?.choices?.[0]?.message?.content ?? "";
        return Response.json({ answer });
      },
    },
  },
});
