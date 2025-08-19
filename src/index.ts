import 'dotenv/config';
import Fastify from 'fastify';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';

const token = process.env.TOKEN!;
const publicUrl = process.env.PUBLIC_URL;
const port = Number(process.env.PORT ?? 3000);
const webhookSecret = process.env.WEBHOOK_SECRET ?? 'change-me';

const MODE = process.env.MODE ?? (process.env.PUBLIC_URL ? 'prod' : 'dev');
const USE_WEBHOOK = MODE === 'prod' && !!publicUrl;

if (!token) {
  console.error('BOT_TOKEN mancante');
  process.exit(1);
}

const bot = new Bot(token);

// --- Middlewares “realtime-ish” ---
bot.api.config.use(async (prev, method, payload) => {
  // Retry leggero per transient errors
  try { return await prev(method, payload); }
  catch (e) { return await prev(method, payload); }
});

// Comandi
bot.command('start', async (ctx) => {
  await ctx.reply(
    `Ciao ${ctx.from?.first_name ?? ''}! Sono online 🚀`,
    { reply_markup: new InlineKeyboard().text('Ping', 'ping').text('Help', 'help') }
  );
});

bot.callbackQuery('ping', async (ctx) => {
  await Promise.all([
    ctx.answerCallbackQuery({ text: 'pong', cache_time: 2 }),
    ctx.editMessageText('Pong 🏓 (latency minimale)'),
  ]);
});

bot.callbackQuery('help', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Comandi:\n/start — avvia\n/help — aiuto');
});

bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (/^\/help/.test(text)) return ctx.reply('Serve aiuto? Scrivi pure.');
  // esempio echo “smart”
  await ctx.reply(`Hai scritto: “${text}”`);
});

// --- Fastify + Webhook ---
const app = Fastify({ logger: true });

// Protezione endpoint con secret path e header
const path = `/webhook/${webhookSecret}`;
if (USE_WEBHOOK) {
  app.post(path, webhookCallback(bot, 'fastify'));
  
  app.get('/health', async () => ({ ok: true }));
}


async function bootstrap() {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Fastify su :${port} (mode: ${MODE})`);

  if (USE_WEBHOOK) {
    // monta IL SOLO webhook in prod
    const path = `/webhook/${webhookSecret}`;
    app.post(path, webhookCallback(bot, 'fastify'));

    // imposta webhook
    await bot.api.setWebhook(`${publicUrl}${path}`, {
      secret_token: webhookSecret,
      allowed_updates: ['message', 'callback_query', 'inline_query'],
    });
    app.log.info(`Webhook impostato su ${publicUrl}${path}`);
  } else {
    // 🔑 disattiva qualsiasi webhook rimasto e fai polling
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch {}
    app.log.warn('Avvio in long polling (dev). Nessun endpoint webhook montato.');
    await bot.start({ allowed_updates: ['message', 'callback_query', 'inline_query'] });
  }
}

bootstrap().catch((e) => {
  app.log.error(e);
  process.exit(1);
});

// shutdown pulito
process.on('SIGINT', () => app.close());
process.on('SIGTERM', () => app.close());
