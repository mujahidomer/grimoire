const { getSupabase } = require('./supabase');
const { getAnthropicClient } = require('./anthropicClient');

// Persistence for library-wide chats (the chats + messages tables). The server
// uses the service-role key (RLS bypassed), so every call scopes by user_id
// explicitly, matching the rest of the data layer (see lib/queryLimits.js).
//
// item_id is left null here: these are library-wide conversations. Single-doc
// chat (deferred) would set item_id and is intentionally not persisted yet.

const TITLE_MAX = 80;

// Create a new library chat and return its id. Title is the opening question,
// trimmed to a single short line.
async function createChat(userId, question) {
  const sb = getSupabase();
  const title = (question || '').trim().slice(0, TITLE_MAX) || 'New chat';
  const { data, error } = await sb
    .from('chats')
    .insert({ user_id: userId, item_id: null, title })
    .select('id')
    .single();
  if (error) throw new Error(`chats insert failed: ${error.message}`);
  return data.id;
}

// Append one message to a chat. role is 'user' | 'assistant'.
// `meta` (nullable jsonb) carries the assistant turn's pipeline trace —
// steps + timings, the resolved sources, model and token counts — so a
// reopened thread can rebuild its thinking timeline and citation chips.
async function saveMessage(userId, chatId, role, content, meta = null) {
  const sb = getSupabase();
  const row = { user_id: userId, chat_id: chatId, role, content };
  if (meta) row.meta = meta;
  const { error } = await sb.from('messages').insert(row);
  if (error) throw new Error(`messages insert failed: ${error.message}`);
}

// After a new chat's first turn completes, replace the truncated-question
// placeholder title with a short Haiku summary. Fire-and-forget from the
// stream's end() — failures just leave the placeholder in place.
const TITLE_MODEL = 'claude-haiku-4-5-20251001';

async function generateChatTitle(userId, chatId, question, answer) {
  try {
    const client = getAnthropicClient();
    const res = await client.messages.create({
      model: TITLE_MODEL,
      max_tokens: 24,
      system: 'Write a 2-4 word title for a chat that began with the question below. Under 30 characters. Sentence case, no filler words like "saved" or "my library". Return ONLY the title: no quotes, no trailing punctuation.',
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nAnswer excerpt: ${(answer || '').slice(0, 400)}`
      }]
    });
    const title = (res.content?.[0]?.text || '')
      .trim()
      .replace(/^["'\u201c\u2018]+|["'\u201d\u2019.]+$/g, '')
      .slice(0, 40);
    if (!title) return;
    const sb = getSupabase();
    const { error } = await sb
      .from('chats')
      .update({ title })
      .eq('id', chatId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[chat-history] title generation failed:', err.message);
  }
}

// Recent library chats for the sidebar, newest first.
async function listChats(userId, limit = 30) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('chats')
    .select('id, title, created_at')
    .eq('user_id', userId)
    .is('item_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`chats read failed: ${error.message}`);
  return data || [];
}

// Delete one chat and (via the messages.chat_id FK's on delete cascade) all
// of its messages. Scoped by user_id so a user can only delete their own.
async function deleteChat(userId, chatId) {
  const sb = getSupabase();
  const { error } = await sb
    .from('chats')
    .delete()
    .eq('id', chatId)
    .eq('user_id', userId);
  if (error) throw new Error(`chat delete failed: ${error.message}`);
}

// All messages for one chat, oldest first. Scoped by user_id so a user can only
// read their own conversations even though RLS is bypassed.
async function listMessages(userId, chatId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('messages')
    .select('role, content, created_at, meta')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`messages read failed: ${error.message}`);
  return data || [];
}

module.exports = { createChat, saveMessage, listChats, listMessages,
  generateChatTitle,
  deleteChat
};
