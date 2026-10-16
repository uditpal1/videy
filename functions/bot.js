// Cloudflare Pages Function: Telegram bot webhook (URL path: /bot)
// Needs these variables in Cloudflare: BOT_TOKEN, WEBHOOK_SECRET, APP_URL, CHANNEL, CHANNEL_LINK

const api = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then((r) => r.json());

// true = joined, false = not joined, null = could not check
async function isMember(env, userId) {
  const r = await api(env, 'getChatMember', { chat_id: env.CHANNEL, user_id: userId });
  if (!r.ok) return null;
  const s = r.result.status;
  return ['creator', 'administrator', 'member'].includes(s) || (s === 'restricted' && r.result.is_member === true);
}

const joinKb = (env) => ({
  inline_keyboard: [
    [{ text: '📢 Join Channel', url: env.CHANNEL_LINK }],
    [{ text: '🔄 Try Again', callback_data: 'check' }]
  ]
});

// Mini App button (web_app): user sees only the button, not the website link
const appKb = (env) => ({
  inline_keyboard: [[{ text: '▶️ Start Mini App', web_app: { url: env.APP_URL } }]]
});

const sendApp = (env, chatId) =>
  api(env, 'sendMessage', {
    chat_id: chatId,
    text: '✅ You are in! Tap the button below to start the Mini App.',
    reply_markup: appKb(env)
  });

export async function onRequestPost({ request, env }) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET)
    return new Response('no', { status: 403 });

  try {
    const u = await request.json();

    // User pressed Start
    if (u.message && u.message.text && u.message.text.startsWith('/start')) {
      const chatId = u.message.chat.id;
      const ok = await isMember(env, u.message.from.id);
      if (ok === true) {
        await sendApp(env, chatId);
      } else if (ok === false) {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text: '👋 Welcome to CineGrid!\n\nPlease join our channel first, then tap "Try Again".',
          reply_markup: joinKb(env)
        });
      } else {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text: 'Could not verify right now. Please try again in a moment.',
          reply_markup: joinKb(env)
        });
      }
    }

    // User pressed Try Again
    if (u.callback_query && u.callback_query.data === 'check') {
      const cb = u.callback_query;
      const ok = await isMember(env, cb.from.id);
      if (ok === true) {
        await api(env, 'answerCallbackQuery', { callback_query_id: cb.id });
        await sendApp(env, cb.message.chat.id);
      } else {
        await api(env, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          show_alert: true,
          text: ok === false
            ? 'You have not joined the channel yet. Please join, then tap Try Again.'
            : 'Could not verify right now. Please try again.'
        });
      }
    }
  } catch (e) {
    // always answer ok so Telegram does not keep retrying
  }
  return new Response('ok');
}
