// services/coordinator.service.ts

import TelegramServiceClass from './telegram.service';
import OpenAIServiceClass from './openai.service';
import DBServiceClass from './db.service';
import { IMessage } from '../models/message.model';
import SchedulerServiceClass from './scheduler.service';
import { generateReminderId } from '../utils';
import logger from '../utils/logger';

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
        logger.info('------------------------------------------------------------------------------------------------------------------------')
        logger.info('------------------------------------------------------------------------------------------------------------------------')
        logger.info('------------------------------------------------------------------------------------------------------------------------')
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

        const utcPlus2 = new Date().setHours(new Date().getHours() + 2);
        const date = `${new Date(utcPlus2).toLocaleDateString()} ${new Date(utcPlus2).toLocaleTimeString()}`;

        const messageText = `The datetime is ${date}. ${ctx.message.text}`;

        // Save user's message to the database
        await this.db.saveMessage(userId, username, messageText, 'user', date);

        // Add user's message to cache
        this.messagesCache[userId].messages.push({
            userId,
            username,
            message: messageText,
            from: 'user',
            timestamp: new Date(date),
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

        logger.info(`username: ${username}`);
        logger.info(`user message: ${ctx.message.text}`);
        logger.info(response);
        // const parseMessage = response.split('------ message content ------')[1].trim();
        // const parseInternalMessage = response.split('------ internal message ------')?.[1].trim()?.split('------ internal message end ------')?.[0]?.split('\n')?.[0];

        if (response) {
            // Save assistant's response to the database
            await this.db.saveMessage(userId, 'Assistant', response, 'assistant', date);

            // Add assistant's message to cache
            this.messagesCache[userId].messages.push({
                userId,
                username: 'Assistant',
                message: response,
                from: 'assistant',
                timestamp: new Date(date),
            } as IMessage);

            // Parse the assistant's response to extract reminders
            this.parseAndScheduleReminder(response, userId, chatId);

            // Reply to the user with the assistant's message content
            const userMessage = this.extractUserMessage(response);
            ctx.reply(userMessage);
            logger.info('------------------------------------------------------------------------------------------------------------------------')
            logger.info('------------------------------------------------------------------------------------------------------------------------')
            logger.info('------------------------------------------------------------------------------------------------------------------------')
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
                    // ... existing cancellation code ...
                } else if (internalMessage.startsWith('UPDATE_REMINDER')) {
                    // Handle reminder update
                    const updateMatch = internalMessage.match(
                        /UPDATE_REMINDER:\s*(.*?),\s*(.*?),\s*(.*)/i
                    );
                    if (updateMatch) {
                        const reminderText = updateMatch[1].trim();
                        const newTimeToNotifyStr = updateMatch[2].trim();
                        const newNotificationText = updateMatch[3].trim();

                        // Validate that all parts are present
                        if (!reminderText || !newTimeToNotifyStr || !newNotificationText) {
                            console.error('Reminder update details are incomplete:', {
                                reminderText,
                                newTimeToNotifyStr,
                                newNotificationText,
                            });
                            return;
                        }

                        // Validate the time format
                        const timeFormatRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
                        if (!timeFormatRegex.test(newTimeToNotifyStr)) {
                            console.error(
                                'New time to notify does not match the expected format:',
                                newTimeToNotifyStr
                            );
                            return;
                        }

                        // Parse the new time to notify
                        const newTimeToNotify = new Date(newTimeToNotifyStr);

                        if (isNaN(newTimeToNotify.getTime())) {
                            console.error('Invalid new time format in reminder update:', newTimeToNotifyStr);
                            return;
                        }

                        // Generate reminderId from reminderText
                        const reminderId = generateReminderId(reminderText);

                        // Update the reminder in the database
                        this.db
                            .updateReminderByReminderId(userId, reminderId, {
                                timeToNotify: newTimeToNotify,
                                notificationText: newNotificationText,
                            })
                            .then((updatedReminder) => {
                                if (updatedReminder) {
                                    // Update the scheduled job
                                    this.scheduler.updateScheduledReminder(updatedReminder);
                                    logger.info('Reminder updated:', {
                                        userId,
                                        chatId,
                                        reminderId,
                                        reminderText,
                                        newTimeToNotify,
                                        newNotificationText,
                                    });
                                } else {
                                    console.error(
                                        `No reminder found to update with reminderId: ${reminderId} for userId: ${userId}`
                                    );
                                }
                            })
                            .catch((error) => {
                                console.error('Error updating reminder:', error);
                            });
                    } else {
                        console.error(
                            'Failed to parse reminder update details from internal message:',
                            internalMessage
                        );
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

                        logger.info('Reminder scheduled:', {
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
            logger.info('No internal message found in response.');
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
        logger.info('Coordinator service started');
    };
}

export default CoordinatorServiceClass;
