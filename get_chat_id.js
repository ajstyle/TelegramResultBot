require('dotenv').config({ override: true });
const TelegramBot = require('node-telegram-bot-api');

const token = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.log('\n❌ Usage: node get_chat_id.js <YOUR_BOT_TOKEN>');
  console.log('   Example: node get_chat_id.js 123456789:ABCdefGhIJKlmNoPQRstuVWxYZ\n');
  process.exit(1);
}

console.log('=============================================================');
console.log('       TELEGRAM CHAT ID FINDER & HELPER BOT SCRIPT           ');
console.log('=============================================================');

const bot = new TelegramBot(token, { polling: true });

bot.getMe().then(me => {
  console.log(`\n🤖 Bot Connected: @${me.username} (${me.first_name})`);
  console.log(`\n👉 NEXT STEP:`);
  console.log(`1. Open Telegram on your phone or desktop.`);
  console.log(`2. Search for: @${me.username}`);
  console.log(`   or open link: https://t.me/${me.username}`);
  console.log(`3. Click 'Start' or send any message (e.g., 'hello').`);
  console.log(`\n⏳ Waiting for incoming message to detect your Chat ID...\n`);
}).catch(err => {
  console.error('❌ Failed to connect with provided Bot Token:', err.message);
  process.exit(1);
});

bot.on('message', msg => {
  const chatId = msg.chat.id;
  const username = msg.chat.username ? `@${msg.chat.username}` : 'No Username';
  const name = `${msg.chat.first_name || ''} ${msg.chat.last_name || ''}`.trim();

  console.log('=============================================================');
  console.log('🎉 MATCH FOUND! RECEIVED MESSAGE FROM USER:');
  console.log(`  👤 Name:     ${name}`);
  console.log(`  🏷️ Username: ${username}`);
  console.log(`  🆔 Chat ID:  ${chatId}`);
  console.log('=============================================================');
  console.log(`\n✅ Copy this Chat ID to your .env file:`);
  console.log(`   AUTHORIZED_TELEGRAM_CHAT_IDS=${chatId}\n`);

  bot.sendMessage(chatId, `✅ <b>Chat ID Detected!</b>\n\nYour Telegram Chat ID is: <code>${chatId}</code>\n\nYour Telegram bot configuration is now ready!`, { parse_mode: 'HTML' })
    .then(() => {
      console.log('Message sent back to Telegram user!');
    })
    .catch(err => console.error('Error sending reply:', err.message));
});
