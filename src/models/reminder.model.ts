import mongoose, { Document, Schema } from 'mongoose';

export interface IReminder {
  userId: number;
  chatId: number;
  reminderId: string;
  reminderText: string;
  notificationText: string;
  timeToNotify: Date;
}

const ReminderSchema: Schema = new Schema({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  reminderId: { type: String, required: true },
  reminderText: { type: String, required: true },
  notificationText: { type: String, required: true },
  timeToNotify: { type: Date, required: true },
});

export default mongoose.model<IReminder>('Reminder', ReminderSchema);
