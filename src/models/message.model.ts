import mongoose, { Document, Schema } from 'mongoose';

export interface IMessage extends Document {
  userId: number;
  username: string;
  message: string;
  from: 'user' | 'assistant';
  timestamp: Date;
}

const MessageSchema: Schema = new Schema({
  userId: { type: Number, required: true },
  username: { type: String },
  message: { type: String, required: true },
  from: { type: String, enum: ['user', 'assistant'], required: true },
  timestamp: { type: Date, default: Date.now },
});

export default mongoose.model<IMessage>('Message', MessageSchema);
