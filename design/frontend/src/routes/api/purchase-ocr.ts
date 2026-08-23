// Purchase invoice OCR — extract structured invoice data from an uploaded image.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/purchase-ocr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        let body: { image?: string; mimeType?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const image = String(body?.image ?? "");
        const mimeType = String(body?.mimeType ?? "image/jpeg");
        if (!image) return new Response("image (data URL or base64) required", { status: 400 });

        const dataUrl = image.startsWith("data:") ? image : `data:${mimeType};base64,${image}`;

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Lovable-API-Key": key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Extract pharmacy purchase invoice data. Return STRICT JSON only: {"invoice_no": string|null, "supplier": string|null, "date": "YYYY-MM-DD"|null, "total": number|null, "items": [{"name": string, "qty": number, "unit_cost": number, "expiry": "YYYY-MM-DD"|null}]}. Numbers only, no currency symbols. Use null when unknown.',
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "Extract the invoice." },
                  { type: "image_url", image_url: { url: dataUrl } },
                ],
              },
            ],
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || `Upstream ${upstream.status}`, { status: upstream.status });
        }
        const data = await upstream.json();
        const raw = data?.choices?.[0]?.message?.content ?? "{}";
        let parsed: unknown = {};
        try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
        return Response.json(parsed);
      },
    },
  },
});
