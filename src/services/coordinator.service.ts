// services/coordinator.service.ts

import TelegramServiceClass from './telegram.service';
import OpenAIServiceClass from './openai.service';
import DBServiceClass from './db.service';
import { IMessage } from '../models/message.model';
import SchedulerServiceClass from './scheduler.service';
import { generateReminderId } from '../utils';
import logger from '../utils/logger';
import LLMMiddlewareService from './llm.middleware.service';
import { Context, Conversation } from 'grammy';
import { DateTime } from 'luxon';

class CoordinatorServiceClass {
    chat: TelegramServiceClass;
    llm: OpenAIServiceClass;
    db: DBServiceClass;
    scheduler: SchedulerServiceClass;
    llmMiddleware: LLMMiddlewareService;
    messagesCache: { [key: number]: { id: number; name: string; messages: IMessage[] } };

    constructor() {
        this.messagesCache = {};
        this.db = new DBServiceClass();
        this.llm = new OpenAIServiceClass();
        this.llmMiddleware = new LLMMiddlewareService(this.llm);
        this.chat = new TelegramServiceClass(this.handleMessage);
        this.scheduler = new SchedulerServiceClass(this.chat.bot, this.db);

        // Register conversation handler
        this.registerConversations();
    }

    private registerConversations() {
        this.chat.bot.use((ctx, next) => {
            if (ctx.conversation.isActive) {
                return next();
            }
            next();
        });

        this.chat.bot.use(Conversation.middleware());

        this.chat.bot.conversation('setTimezoneConversation', this.setTimezoneConversation.bind(this));
    }

    handleMessage = async (ctx: Context) => {
        logger.info('--- New Message Received ---');
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;
        const username = ctx.from?.first_name || ctx.from?.username || 'Unknown';

        if (!userId) {
            logger.warn('User ID not found.');
            return;
        }

        // Initialize user in cache if not present
        if (!this.messagesCache[userId]) {
            // Retrieve existing messages from the database
            const messagesFromDb = await this.db.getMessages(userId);
            this.messagesCache[userId] = {
                id: userId,
                name: username,
                messages: messagesFromDb,
            };
        }

        const date = `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
        const messageText = `The datetime is ${date}. ${ctx.message?.text}`;

        // Save user's message to the database
        await this.db.saveMessage(userId, username, messageText, 'user');

        // Add user's message to cache
        this.messagesCache[userId].messages.push({
            userId,
            username,
            message: messageText,
            from: 'user',
            timestamp: new Date(),
        } as IMessage);

        // Retrieve user's timezone
        const userTimeZone = await this.db.getUserTimeZone(userId);
        if (!userTimeZone) {
            // @ts-ignore
            await ctx.conversation?.enter('setTimezoneConversation');
            return;
        }

        // Build conversation history for OpenAI
        const conversationMessages = [
            { role: 'system', content: this.llm.senteContext },
            { role: 'user', content: `my name is ${username}` },
            ...this.messagesCache[userId].messages.map((msg) => ({
                role: msg.from === 'user' ? 'user' : 'assistant',
                content: msg.message,
            })),
        ];

        const response = await this.llm.sendMessage(conversationMessages);

        logger.info(`username: ${username}`);
        logger.info(`user message: ${ctx.message.text}`);
        logger.info(`Assistant response: ${response}`);

        if (response) {
            // Save assistant's response to the database
            await this.db.saveMessage(userId, 'Assistant', response, 'assistant');

            // Add assistant's message to cache
            this.messagesCache[userId].messages.push({
                userId,
                username: 'Assistant',
                message: response,
                from: 'assistant',
                timestamp: new Date(),
            } as IMessage);

            // Parse the assistant's response to extract reminders
            this.parseAndScheduleReminder(response, userId, chatId, userTimeZone);

            // Reply to the user with the assistant's message content
            const userMessage = this.extractUserMessage(response);
            await ctx.reply(userMessage);
            logger.info('--- Message Processed Successfully ---');
        }
    };

    private async setTimezoneConversation(conversation: Conversation, ctx: Context) {
        await ctx.reply("Please tell me your location (city or country), and I'll set your timezone.");

        const userInput = await conversation.wait();

        const location = userInput.message?.text;
        if (!location) {
            await ctx.reply("I didn't understand that. Please provide a valid city or country.");
            return;
        }

        try {
            // Process location to get timezone via LLM
            const { timezone, explanation } = await this.llmMiddleware.processUserInput<string, { timezone: string; explanation: string }>(
                location,
                'location_to_timezone'
            );

            // Validate timezone using Luxon
            const isValid = this.llmMiddleware.validateTimezone(timezone);
            if (!isValid) {
                await ctx.reply("I couldn't determine a valid timezone from the location provided. Please try again.");
                return;
            }

            // Save timezone to the database
            await this.db.setUserTimeZone(ctx.from?.id || 0, timezone);
            logger.info(`Set timezone for user ${ctx.from?.id}: ${timezone} (${explanation})`);

            await ctx.reply(`Great! I've set your timezone to ${timezone}. ${explanation}`);

            // End the conversation
            await conversation.exit();
        } catch (error) {
            logger.error('Error processing location for timezone:', error);
            await ctx.reply("I'm sorry, I couldn't determine your timezone. Please try again with a more specific location.");
        }
    }

    private async parseAndScheduleReminder(response: string, userId: number, chatId: number, userTimeZone: string) {
        // Implement your reminder parsing and scheduling logic here
        // This could involve parsing the LLM response for reminder details
        // and then using the SchedulerService to schedule them
    }

    private extractUserMessage(response: string): string {
        const messageContentMatch = response.match(/------ message content ------\s*([\s\S]*)/);
        if (messageContentMatch) {
            return messageContentMatch[1].trim();
        } else {
            return response; // If no specific message content section, return the whole response
        }
    }

    start = async () => {
        logger.info('Coordinator service started');
    };
}

export default CoordinatorServiceClass;
