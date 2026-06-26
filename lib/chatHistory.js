const { getSupabase } = require('./supabase');

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
async function saveMessage(userId, chatId, role, content) {
  const sb = getSupabase();
  const { error } = await sb
    .from('messages')
    .insert({ user_id: userId, chat_id: chatId, role, content });
  if (error) throw new Error(`messages insert failed: ${error.message}`);
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

// All messages for one chat, oldest first. Scoped by user_id so a user can only
// read their own conversations even though RLS is bypassed.
async function listMessages(userId, chatId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('messages')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`messages read failed: ${error.message}`);
  return data || [];
}

module.exports = { createChat, saveMessage, listChats, listMessages };
