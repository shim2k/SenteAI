import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  userId: number;
  timeZone: string;
}

const UserSchema: Schema = new Schema({
  userId: { type: Number, required: true, unique: true },
  timeZone: { type: String, required: true },
});

export default mongoose.model<IUser>('User', UserSchema);
