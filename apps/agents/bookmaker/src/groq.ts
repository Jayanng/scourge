/**
 * Optional Groq phrasing — NEVER in the hot-path decision loop.
 * Only rewrites the human-readable question string after templates fire.
 */
import { fetch } from 'undici';

export async function maybePolishQuestion(
  question: string,
  opts: { apiKey?: string; enabled: boolean; model?: string },
): Promise<string> {
  if (!opts.enabled || !opts.apiKey) return question;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model ?? 'llama-3.1-8b-instant',
        temperature: 0.2,
        max_tokens: 80,
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the prediction-market question to be clear and punchy. Keep the same meaning and any minute/player numbers. Reply with only the question text.',
          },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!res.ok) return question;
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text && text.length > 8 ? text.replace(/^["']|["']$/g, '') : question;
  } catch {
    return question;
  }
}
