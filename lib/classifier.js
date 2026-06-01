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

For "skill" and "mcp" types, add an "installSource" field — the EXACT install command or URL. Examples: "npx impeccable skills install", "npm install -g @modelcontextprotocol/server-github", or the direct install URL. If you know the tool, provide the exact command. If unknown, set to "Unknown — send the tool URL to Grimoire".

Each item: {"type","skillName","topic","description","whenToUse","howToApply","example"}
Skills and MCPs also need: "installSource"

"topic" = the domain this covers. Examples: design, coding, writing, agents, productivity, data, marketing, research, video, audio, devops. Pick the most specific one that fits.
If nothing extractable, return [].`;

const RESEARCH_PROMPT = `You know the Claude/AI ecosystem well. Given a URL, extract relevant skills, MCPs, connectors, prompts, or insights. Return ONLY a JSON array, no markdown, no preamble. Start with [ end with ].

Types: skill(installable Claude package), mcp(MCP server), connector(integration/platform), prompt(technique/pattern), insight(general knowledge)

Each item: {"type","skillName","topic","description","whenToUse","howToApply","example"}
Skills and MCPs also need: "installSource". "topic" = domain (design, coding, writing, agents, productivity, data, marketing, research, video, audio, devops)`;

async function processContent(text, sourceUrl) {
  const truncatedText = text.substring(0, 4000);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search'
    }],
    messages: [{
      role: 'user',
      content: `URL: ${sourceUrl}\n\n${truncatedText}\n\nFor any skill or MCP mentioned, search for the EXACT install command and include it in installSource. Return ONLY a JSON array.`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response');
  return parseResponse(textBlock.text);
}

async function researchUrl(sourceUrl) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: RESEARCH_PROMPT,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search'
    }],
    messages: [{
      role: 'user',
      content: `Research this and extract all relevant Claude/AI skills, MCPs, connectors, prompts, or insights: ${sourceUrl}

For any skill or MCP found, search for the EXACT install command (e.g. "npx ...", "npm install ...", or a direct install URL). Include it in the installSource field.

Return ONLY a JSON array. Start with [ end with ].`
    }]
  });

  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No response');
  return parseResponse(textBlock.text);
}

function extractJsonArray(text) {
  // Strip markdown code fences
  let s = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

  const start = s.indexOf('[');
  if (start === -1) return null;

  // Walk forward tracking depth so we get the first complete [...] block,
  // not whatever the greedy /\[[\s\S]*\]/ regex would grab.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseResponse(text) {
  const extracted = extractJsonArray(text);
  const cleaned = extracted ?? text.trim();

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
