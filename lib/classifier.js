const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Extract Claude/AI skills and knowledge from content. Return ONLY a JSON array, no markdown, no preamble.

STRICT TYPE DEFINITIONS — pick exactly one:
- "skill": A named installable Claude skill package (e.g. frontend-design, docx, impeccable). Must be something you install in Claude.ai.
- "mcp": A Model Context Protocol server that connects Claude to external tools or data (e.g. Google Drive MCP, GitHub MCP, Slack MCP).
- "connector": A third-party platform, integration, or workflow tool that works with Claude (e.g. Make.com, Zapier, n8n, browser extensions, Slack bots).
- "prompt": A prompt pattern, technique, persona, instruction set, or way of talking to Claude better (e.g. chain-of-thought, XML tagging, role prompting).
- "insight": General knowledge, best practices, comparisons, use case ideas, or anything that doesn't fit above.

Each item: {"type","skillName","description","whenToUse","howToApply","example"}
If nothing extractable, return [].`;

const RESEARCH_PROMPT = `You know the Claude/AI ecosystem well. Given a URL, extract relevant skills, MCPs, connectors, prompts, or insights. Return ONLY a JSON array, no markdown, no preamble. Start with [ end with ].

Types: skill(installable Claude package), mcp(MCP server), connector(integration/platform), prompt(technique/pattern), insight(general knowledge)

Each item: {"type","skillName","description","whenToUse","howToApply","example"}`;

async function processContent(text, sourceUrl) {
  const truncatedText = text.substring(0, 4000);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `URL: ${sourceUrl}\n\n${truncatedText}`
    }]
  });

  return parseResponse(response.content[0].text);
}

async function researchUrl(sourceUrl) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: RESEARCH_PROMPT,
    messages: [{
      role: 'user',
      content: `Extract all relevant Claude/AI skills, MCPs, connectors, prompts, or insights from this URL: ${sourceUrl}`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response');
  return parseResponse(textBlock.text);
}

function parseResponse(text) {
  let cleaned = text.trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  } else {
    cleaned = cleaned.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  }

  try {
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) throw new Error('Not an array');
    return items.map(item => ({ ...item, fileName: generateFileName(item) }));
  } catch (err) {
    throw new Error(`Invalid JSON: ${cleaned.substring(0, 200)}`);
  }
}

function generateFileName(item) {
  const descriptor = (item.skillName || 'unnamed')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 40)
    .replace(/-+$/, '');
  return `${item.type}-${descriptor}.md`;
}

module.exports = { processContent, researchUrl };
