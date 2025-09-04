// app/api/chat/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import mammoth from "mammoth";

// --------- 타입들 ----------
type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
type MultiModalContent = TextPart | ImagePart;

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | MultiModalContent[] }
  | { role: "assistant"; content?: string };

type TogetherChoice = { message?: { role: string; content?: string } };
type TogetherResp = { choices?: TogetherChoice[] };

// --------- Together API (fetch로 직접 호출) ----------
async function chatCompletes(input: {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}): Promise<TogetherResp> {
  const resp = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      ...(input.max_tokens !== undefined ? { max_tokens: input.max_tokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as TogetherResp;
  if (!resp.ok) {
    throw new Error(`${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// --------- 유틸 ----------
function chunk(text: string, maxChars = 15_000): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
  return out;
}

export async function POST(req: Request) {
  try {
    const RAW = process.env.TOGETHER_MODEL ?? process.env.TOGETHER_GEMMA_MODEL ?? "";
    const MODEL = RAW.trim();
    if (!MODEL) return NextResponse.json({ error: "Missing TOGETHER_MODEL" }, { status: 500 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "file missing" }, { status: 400 });

    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();

    // ---------- 이미지 ----------
    const isImage =
      type.startsWith("image/") ||
      [".png", ".jpg", ".jpeg", ".webp"].some((ext) => name.endsWith(ext));

    if (isImage) {
      const ab = await file.arrayBuffer();
      const buf = Buffer.from(ab);
      const mime = type || "image/jpeg";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

      const r = await chatCompletes({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "이 이미지를 한국어로 간결히 요약해줘. 핵심 bullet 3~6개." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 600,
        temperature: 0.2,
      });

      const summary = r.choices?.[0]?.message?.content ?? "";
      return NextResponse.json({ summary });
    }

    // ---------- 문서 (PDF/DOCX/PPTX/TXT) ----------
    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);

    let text = "";

    if (name.endsWith(".pdf") || type === "application/pdf") {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
        dataBuffer: Buffer
      ) => Promise<{ text?: string }>;
      const parsed = await pdfParse(buf);
      text = parsed.text ?? "";
    } else if (name.endsWith(".docx")) {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      text = value ?? "";
    } else if (
      name.endsWith(".pptx") ||
      type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ) {
      // 기존과 동일: pptx-parser 사용
      const { parsePptx } = (await import("pptx-parser")) as {
        parsePptx: (input: Buffer | ArrayBuffer | Uint8Array) => Promise<Array<{ text?: string; notes?: string }>>;
      };
      const slides = await parsePptx(buf);
      text = slides
        .map((s) => [s.text ?? "", s.notes ?? ""].filter(Boolean).join("\n"))
        .join("\n\n")
        .trim();
    } else if (type === "text/plain" || name.endsWith(".txt")) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "지원 확장자: PDF, DOCX, PPTX, TXT, 이미지(PNG/JPG/WEBP)" },
        { status: 400 }
      );
    }

    if (!text.trim()) {
      return NextResponse.json({ error: "본문이 비어 있습니다" }, { status: 400 });
    }

    // 길이에 따라: 원샷 또는 청크 → 통합
    const approxTokens = Math.ceil(text.length / 4);
    const MAX_SAFE = 80_000;
    const parts = approxTokens <= MAX_SAFE ? [text] : chunk(text, 15_000);

    const partials: string[] = [];
    for (const [i, part] of parts.entries()) {
      const r = await chatCompletes({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "문서를 구조적으로 요약하라. 핵심 요지, 근거/수치, 한계/주의점을 항목화하라. 가급적 1000자 이내로 요약하라.",
          },
          { role: "user", content: `문서 일부(${i + 1}/${parts.length})를 한국어로 간결히 요약:\n\n${part}` },
        ],
        max_tokens: 1300,
        temperature: 0.2,
      });
      partials.push(r.choices?.[0]?.message?.content ?? "");
    }

    let summary = partials.join("\n\n");
    if (partials.length > 1) {
      const r2 = await chatCompletes({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "아래 부분 요약들을 하나의 일관된 최종 요약으로 통합하라. 중복 제거, 명확한 항목화, 결론/액션아이템 포함.",
          },
          { role: "user", content: partials.join("\n\n---\n\n") },
        ],
        max_tokens: 1100,
        temperature: 0.2,
      });
      summary = r2.choices?.[0]?.message?.content ?? summary;
    }

    return NextResponse.json({ summary });
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : typeof e === "string" ? e : "internal error";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}