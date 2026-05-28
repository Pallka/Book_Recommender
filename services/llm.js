const Anthropic = require("@anthropic-ai/sdk");

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

function extractJsonBlock(text) {
    if (!text) return "";
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

    const firstObj = s.indexOf("{");
    const firstArr = s.indexOf("[");
    let start;
    if (firstObj === -1 && firstArr === -1) return s;
    if (firstObj === -1) start = firstArr;
    else if (firstArr === -1) start = firstObj;
    else start = Math.min(firstObj, firstArr);

    const open = s[start];
    const close = open === "{" ? "}" : "]";
    const end = s.lastIndexOf(close);
    return end > start ? s.slice(start, end + 1) : s.slice(start);
}

function safeJsonParse(text, fallback = null) {
    try {
        return JSON.parse(extractJsonBlock(text));
    } catch {
        return fallback;
    }
}

async function callClaude(prompt, { maxTokens = 1024 } = {}) {
    const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
    });
    const blocks = Array.isArray(message.content) ? message.content : [];
    const text = blocks
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
    if (!text) throw new Error("Claude returned empty content");
    return text;
}

async function callOllamaCompatible(prompt, { temperature = 0.2 } = {}) {
    const url = `${OLLAMA_BASE_URL}/chat/completions`;
    const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            messages: [
                {
                    role: "system",
                    content: "You are a strict JSON-only assistant. Reply with a single JSON value (object or array) and no other text.",
                },
                { role: "user", content: prompt },
            ],
            temperature,
        }),
    });
    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Ollama ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text =
        data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error("Ollama returned empty content");
    return String(text).trim();
}

/**
 * JSON-oriented LLM call: Claude when `ANTHROPIC_API_KEY` is set, else Ollama.
 * @param {string} prompt user/task prompt
 * @param {{ maxTokens?: number }} [opts]
 * @returns {Promise<{ text: string, source: "claude"|"ollama" }>}
 */
async function callLlmForJson(prompt, opts = {}) {
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            const text = await callClaude(prompt, opts);
            return { text, source: "claude" };
        } catch (e) {
            console.warn("[llm] Claude failed, falling back to Ollama:", e && e.message ? e.message : e);
        }
    }
    const text = await callOllamaCompatible(prompt, opts);
    return { text, source: "ollama" };
}

module.exports = {
    callLlmForJson,
    callClaude,
    callOllamaCompatible,
    extractJsonBlock,
    safeJsonParse,
};
