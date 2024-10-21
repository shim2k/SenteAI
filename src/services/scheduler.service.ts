import schedule, { Job } from 'node-schedule';
import { Bot } from 'grammy';
import DBServiceClass from './db.service';
import { IReminder } from '../models/reminder.model';

class SchedulerServiceClass {
  private scheduledJobs: Map<string, Job>;
  private dbService: DBServiceClass;

  constructor(private bot: Bot, dbService: DBServiceClass) {
    this.scheduledJobs = new Map();
    this.dbService = dbService;
    this.loadRemindersFromDatabase();
  }

  // Load reminders from the database and schedule them
  async loadRemindersFromDatabase() {
    const reminders = await this.dbService.getAllReminders();
    for (const reminder of reminders) {
      this.scheduleReminder(reminder);
    }
  }

  // Schedule a reminder
  scheduleReminder(reminder: IReminder) {
    const job = schedule.scheduleJob(new Date(reminder.timeToNotify), async () => {
      try {
        // Send the reminder message via Telegram
        await this.bot.api.sendMessage(reminder.chatId, reminder.notificationText);

        // Remove the reminder from the database and scheduledJobs map after sending
        await this.dbService.cancelReminderByReminderId(reminder.userId, reminder.reminderId);
        this.scheduledJobs.delete(reminder.reminderId);
      } catch (error) {
        console.error('Error sending reminder:', error);
      }
    });

    // Store the job using reminderId as the key
    this.scheduledJobs.set(reminder.reminderId, job);
  }

  // Add a new reminder
  async addReminder(reminderData: Omit<IReminder, '_id'>) {
    const reminder = await this.dbService.addReminder(reminderData);
    this.scheduleReminder(reminder);
  }

  // Cancel a reminder by reminderId
  async cancelReminderByReminderId(userId: number, reminderId: string) {
    const job = this.scheduledJobs.get(reminderId);
    if (job) {
      job.cancel();
      this.scheduledJobs.delete(reminderId);
    }

    const success = await this.dbService.cancelReminderByReminderId(userId, reminderId);
    if (success) {
      console.log(`Cancelled reminder: ${reminderId}`);
    } else {
      console.log(`No reminder found with reminderId: ${reminderId} for userId: ${userId}`);
    }
  }
}

export default SchedulerServiceClass;
