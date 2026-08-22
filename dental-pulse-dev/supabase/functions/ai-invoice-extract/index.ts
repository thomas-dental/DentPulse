import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ai-invoice-extract — server-side proxy for the Accounts Payable invoice
// OCR / parsing calls. Calls the Anthropic (Claude) API directly with a
// server-side key. The browser must NOT call an AI API directly: those
// endpoints send no CORS headers, and a key in a VITE_ env var is exposed to
// every user. This keeps the key in a Supabase secret (ANTHROPIC_API_KEY).
//
// The frontend (openAIService.ts) sends OpenAI-style messages; this function
// translates them to the Anthropic Messages API:
//   • a `system` role message  → top-level `system` string
//   • { type: 'image_url', image_url:{ url:'data:<mime>;base64,<data>' } }
//                               → { type:'image', source:{ type:'base64', … } }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";

// Translate an OpenAI-style message `content` to Anthropic content.
// A plain string is passed through; an array of blocks is converted.
function toAnthropicContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  const blocks: unknown[] = [];
  for (const block of content as any[]) {
    if (block?.type === "text") {
      blocks.push({ type: "text", text: block.text ?? "" });
    } else if (block?.type === "image_url") {
      const url: string = block.image_url?.url ?? "";
      const match = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        });
      } else if (url) {
        // A plain (non-data) image URL — Anthropic supports a url source.
        blocks.push({ type: "image", source: { type: "url", url } });
      }
    }
  }
  return blocks;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // `response_format` is accepted for backward compatibility but ignored —
    // Anthropic has no such param; the prompts already instruct JSON-only and
    // the caller strips any code fences before parsing.
    const { messages, max_tokens, temperature, apiKey } = await req.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "A non-empty messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Key comes from the backend (per-user / tenant key), passed by the caller.
    const ANTHROPIC_API_KEY = apiKey;
    if (!ANTHROPIC_API_KEY) {
      console.error("[ai-invoice-extract] no API key provided by the backend");
      return new Response(
        JSON.stringify({ error: "No API key provided by the backend." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const model = Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_MODEL;

    // Split out system messages; translate the rest to Anthropic shape.
    let system = "";
    const anthropicMessages: Array<{ role: string; content: unknown }> = [];
    for (const msg of messages as any[]) {
      if (msg?.role === "system") {
        if (typeof msg.content === "string") system += `${msg.content}\n`;
        continue;
      }
      anthropicMessages.push({
        role: msg?.role === "assistant" ? "assistant" : "user",
        content: toAnthropicContent(msg?.content),
      });
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: typeof max_tokens === "number" ? max_tokens : 4096,
      messages: anthropicMessages,
    };
    if (system.trim()) body.system = system.trim();
    if (typeof temperature === "number") body.temperature = temperature;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ai-invoice-extract] Anthropic error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ error: "AI service authentication failed — check the Anthropic API key." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 400) {
        let detail = "AI request was rejected";
        try { detail = JSON.parse(errorText)?.error?.message || detail; } catch { /* noop */ }
        return new Response(
          JSON.stringify({ error: detail }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: "AI extraction request failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await response.json();
    // Anthropic Messages API → { content: [{ type:'text', text:'…' }, …] }
    const content = Array.isArray(result?.content)
      ? result.content
          .filter((b: any) => b?.type === "text")
          .map((b: any) => b.text)
          .join("")
      : "";

    return new Response(
      JSON.stringify({ content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[ai-invoice-extract] error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
