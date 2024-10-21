import { Bot } from 'grammy';

class TelegramServiceClass {
  bot: Bot;

  constructor(messageHandler: (ctx: any) => Promise<void>) {
    this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

    this.bot.on('message', messageHandler);

    this.bot.start();
  }
}

export default TelegramServiceClass;
