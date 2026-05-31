const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert at extracting and categorizing AI/Claude skills, techniques, and knowledge from raw content.

Your job is to analyze content and extract ALL distinct skills, techniques, workflows, or insights mentioned.

CONTENT TYPES — classify each item as one of:
- "skill": An installable Claude skill package (e.g. frontend-design, docx, pdf, impeccable)
- "markdown": A prompt pattern, instruction set, persona, thinking framework, or technique used as context
- "agent": An autonomous AI workflow, multi-step process, or agentic system
- "insight": A general tip, principle, best practice, or learning about working with AI/tools

CATEGORIES — classify each item as one of:
- "prompting": Prompt engineering patterns and techniques
- "workflow": Step-by-step processes and execution flows
- "output": Output formatting, structured responses, templates
- "design": UI/UX, visual design, frontend techniques
- "data": Data analysis, processing, querying
- "testing": Testing strategies and QA approaches
- "thinking": Reasoning frameworks, mental models, decision-making
- "tool-use": MCP tools, integrations, APIs, automation platforms
- "research": Research methodologies and information gathering
- "coding": Code generation, debugging, architecture
- "writing": Writing, editing, content creation
- "other": Doesn't fit the above

RULES:
- Extract EVERY distinct skill, tool, or technique mentioned, even briefly
- Use the EXACT name as mentioned in the content
- If a skill has no clear name, give it a descriptive one
- Be specific in howToApply — give actionable instructions
- Return ONLY a valid JSON array, no markdown fences, no explanation
- If content has no extractable skills or insights, return an empty array []`;

const RESEARCH_PROMPT = `You are an expert at researching AI tools, platforms, and techniques.

The user has saved a URL that could not be scraped. Research what this URL/tool/platform is about and extract all relevant skills, workflows, agents, or insights from it.

Use your knowledge to generate accurate, useful entries. Focus on:
- What the tool/platform does
- How it relates to AI, automation, or productivity
- Specific features or techniques that are worth saving
- How someone would actually use it

Return ONLY a valid JSON array, no markdown fences, no explanation.`;

async function processContent(text, sourceUrl) {
  const truncatedText = text.substring(0, 10000);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Source URL: ${sourceUrl}

Content:
${truncatedText}

Extract all skills, techniques, and insights. Return as JSON array where each item has:
{
  "type": "skill|markdown|agent|insight",
  "category": "[from category list]",
  "skillName": "Name of the skill or technique",
  "description": "One sentence: what it does",
  "whenToUse": "Specific scenarios where this applies",
  "howToApply": "Step-by-step: how to actually use this",
  "example": "One concrete before/after or usage example"
}`
    }]
  });

  return parseResponse(response.content[0].text);
}

async function researchUrl(sourceUrl) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: RESEARCH_PROMPT,
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search'
    }],
    messages: [{
      role: 'user',
      content: `Research this URL and extract all relevant AI skills, tools, agents, or insights from it: ${sourceUrl}

Return as JSON array where each item has:
{
  "type": "skill|markdown|agent|insight",
  "category": "[from category list]",
  "skillName": "Name of the skill, tool or technique",
  "description": "One sentence: what it does",
  "whenToUse": "Specific scenarios where this applies",
  "howToApply": "Step-by-step: how to actually use this",
  "example": "One concrete before/after or usage example"
}`
    }]
  });

  // Find the final text response (after any tool use)
  const textBlock = response.content.filter(b => b.type === 'text').pop();
  if (!textBlock) throw new Error('No text response from research');

  return parseResponse(textBlock.text);
}

function parseResponse(text) {
  // Strip all markdown fences and find the JSON array
  let cleaned = text.trim();

  // Extract just the JSON array if it's wrapped in other text
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    cleaned = arrayMatch[0];
  } else {
    cleaned = cleaned
      .replace(/```json\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();
  }

  try {
    const items = JSON.parse(cleaned);
    if (!Array.isArray(items)) throw new Error('Response is not an array');
    return items.map(item => ({ ...item, fileName: generateFileName(item) }));
  } catch (err) {
    throw new Error(`Claude returned invalid JSON: ${cleaned.substring(0, 300)}`);
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

  return `${item.type}-${item.category}-${descriptor}.md`;
}

module.exports = { processContent, researchUrl };
