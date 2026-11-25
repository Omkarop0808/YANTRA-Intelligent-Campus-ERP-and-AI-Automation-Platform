import { Schema, type Model, type Types } from 'mongoose';
import { User, type UserDoc } from './User';

export interface ParentDoc extends UserDoc {
  children: Types.ObjectId[];
  phone?: string;
}

const parentSchema = new Schema<ParentDoc>({
  children: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
  phone: { type: String, trim: true },
});

export const Parent: Model<ParentDoc> = User.discriminator<ParentDoc>('parent', parentSchema);
