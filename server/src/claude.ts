import Anthropic from '@anthropic-ai/sdk'

// lazy: the key isn't in process.env until dotenv has run
let client: Anthropic | null = null

function getClient(): Anthropic {
    if (!client) {
        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
        client = new Anthropic({
        apiKey,
        timeout: 15_000,  // 15 second
        maxRetries: 1, 
        })
    }
    return client
}

const SYSTEM_PROMPT = `You write short etymology notes for a Chinese character learning app.

Rules:
- Two or three sentences, 40-70 words. Plain, factual prose.
- Prefer accounts that are well established in Chinese paleography.
- Where scholars disagree, say so plainly.
- Never invent scholar names, dates, dynasties, or sources. If you are not confident
  about the origin, describe the character's visual composition instead — that is
  always safe and still useful to a learner.
- Write for an English-speaking learner. No headings, no bullet points, no preamble.
- Return only the paragraph itself.`

// few-shot beats describing the style in words
const EXAMPLES: Anthropic.MessageParam[] = [
    { role: 'user', content: 'Character: 一\nPinyin: yī\nMeaning: one' },
    {
        role: 'assistant',
        content:
        'One of the simplest characters in the writing system, it was a single horizontal ' +
        'stroke in oracle bone inscriptions carved over 3,000 years ago. It belongs to a small ' +
        'set of numerals (一, 二, 三) whose forms literally tally the value they represent.',
    },
    { role: 'user', content: 'Character: 王\nPinyin: wáng\nMeaning: king' },
    {
        role: 'assistant',
        content:
        'Three horizontal lines connected by a single vertical stroke were explained by the Han ' +
        'dynasty scholar Xu Shen as representing Heaven, Earth, and Humanity united by the ruler ' +
        'who connects them. Modern paleographers instead believe the character began as a picture ' +
        'of a ceremonial axe, a symbol of the military authority held by early rulers.',
    },
]

// model output is untrusted external input, same as a request body
const MIN_LENGTH = 100
const MAX_LENGTH = 600
const REFUSAL = /^(i cannot|i can't|i am unable|i'm unable|i don't have|as an ai)/i

function isUsable(text: string): boolean {
    return text.length >= MIN_LENGTH && text.length <= MAX_LENGTH && !REFUSAL.test(text)
}

// null means "no usable content this time" — the caller degrades
export async function generateStory(
    character: string,
    pinyin: string,
    meaning: string
): Promise<string | null> {
    try {
        const res = await getClient().messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,      
            temperature: 0.3,    
            system: SYSTEM_PROMPT,
            messages: [
                ...EXAMPLES,
                { role: 'user', content: `Character: ${character}\nPinyin: ${pinyin}\nMeaning: ${meaning}` },
            ],
        })


        const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
        const text = block?.text.trim() ?? ''

        if (!isUsable(text)) {
            console.error('[claude] unusable response', {
                character,
                length: text.length,
                preview: text.slice(0, 80),
            })
            return null
        }
        return text
    } catch (err) {
        console.error('[claude] generation failed', { character, err })
        return null
    }
}