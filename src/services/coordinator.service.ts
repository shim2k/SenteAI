// services/coordinator.service.ts

import TelegramServiceClass from './telegram.service';
import OpenAIServiceClass from './openai.service';
import DBServiceClass from './db.service';
import { IMessage } from '../models/message.model';
import SchedulerServiceClass from './scheduler.service';
import { generateReminderId } from '../utils';

class CoordinatorServiceClass {
    chat: TelegramServiceClass;
    llm: OpenAIServiceClass;
    db: DBServiceClass;
    scheduler: SchedulerServiceClass;
    messagesCache: { [key: number]: { id: number; name: string; messages: IMessage[] } };

    constructor() {
        this.messagesCache = {};
        this.db = new DBServiceClass();
        this.llm = new OpenAIServiceClass();
        this.chat = new TelegramServiceClass(this.handleMessage);
        this.scheduler = new SchedulerServiceClass(this.chat.bot, this.db);
    }

    handleMessage = async (ctx: any) => {
        const userId = ctx.message.from.id;
        const chatId = ctx.chat.id;
        const username = ctx.message.from.first_name || ctx.message.from.username || 'Unknown';

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

        const messageText = `The datetime is ${date}. ${ctx.message.text}`;

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

        // console.log('----------')
        // console.log(username);
        // console.log(response);
        // console.log('----------')

        console.log('----------')
        console.log('----------')
        console.log('----------')
        const parseMessage = response.split('------ message content ------')[1].trim();
        const parseInternalMessage = response.split('------ internal message ------')?.[1].trim()?.split('------ internal message end ------')?.[0]?.split('\n')?.[0];
        console.log('parseInternalMessage: ', parseInternalMessage);
        console.log('parseMessage: ', parseMessage);
        console.log('----------')
        console.log('----------')
        console.log('----------')

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
            this.parseAndScheduleReminder(response, userId, chatId);

            // Reply to the user with the assistant's message content
            const userMessage = this.extractUserMessage(response);
            ctx.reply(userMessage);
        }
    };

    parseAndScheduleReminder(response: string, userId: number, chatId: number) {
        // Extract the internal message section
        const internalMessageMatch = response.match(
            /------ internal message ------\s*([\s\S]*?)\s*------ internal message end ------/
        );

        if (internalMessageMatch) {
            const internalMessage = internalMessageMatch[1].trim();

            if (internalMessage) {
                if (internalMessage === 'NONE') {
                    // No reminder to process
                    return;
                } else if (internalMessage.startsWith('CANCEL')) {
                    // Handle cancellation
                    const cancelMatch = internalMessage.match(/^CANCEL\s+(.*)$/);
                    if (cancelMatch) {
                        const reminderText = cancelMatch[1].trim();
                        if (reminderText) {
                            const reminderId = generateReminderId(reminderText);
                            // Cancel the reminder
                            this.scheduler.cancelReminderByReminderId(userId, reminderId);
                            console.log(`Reminder cancelled: ${reminderId}`);
                        } else {
                            console.error('No reminderText provided after CANCEL in internal message.');
                        }
                    } else {
                        console.error('Failed to parse CANCEL command in internal message.');
                    }
                } else {
                    // Handle new reminder
                    // Parse the reminder details
                    const reminderMatch = internalMessage.match(/REMINDER:\s*(.*?),\s*(.*?),\s*(.*)/i);
                    if (reminderMatch) {
                        const reminderText = reminderMatch[1].trim();
                        const timeToNotifyStr = reminderMatch[2].trim();
                        const notificationText = reminderMatch[3].trim();

                        // Validate that all parts are present
                        if (!reminderText || !timeToNotifyStr || !notificationText) {
                            console.error('Reminder details are incomplete:', {
                                reminderText,
                                timeToNotifyStr,
                                notificationText,
                            });
                            return;
                        }

                        // Validate the time format
                        const timeFormatRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
                        if (!timeFormatRegex.test(timeToNotifyStr)) {
                            console.error('Time to notify does not match the expected format:', timeToNotifyStr);
                            return;
                        }

                        // Parse the time to notify
                        const timeToNotify = new Date(timeToNotifyStr);

                        if (isNaN(timeToNotify.getTime())) {
                            console.error('Invalid time format in reminder:', timeToNotifyStr);
                            return;
                        }

                        // Generate reminderId from reminderText
                        const reminderId = generateReminderId(reminderText);

                        // Schedule the reminder
                        this.scheduler.addReminder({
                            userId,
                            chatId,
                            reminderId,
                            reminderText,
                            notificationText,
                            timeToNotify,
                        });

                        console.log('Reminder scheduled:', {
                            userId,
                            chatId,
                            reminderId,
                            reminderText,
                            notificationText,
                            timeToNotify,
                        });
                    } else {
                        console.error('Failed to parse reminder details from internal message:', internalMessage);
                    }
                }
            }
        } else {
            console.log('No internal message found in response.');
        }
    }

    extractUserMessage(response: string): string {
        const messageContentMatch = response.match(/------ message content ------\s*([\s\S]*)/);
        if (messageContentMatch) {
            return messageContentMatch[1].trim();
        } else {
            return response; // If no specific message content section, return the whole response
        }
    }


    start = async () => {
        console.log('Coordinator service started');
    };
}

export default CoordinatorServiceClass;
