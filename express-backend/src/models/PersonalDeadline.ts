import { Schema, model, type Document, type Model, type Types } from 'mongoose';

export interface PersonalDeadlineDoc extends Document {
  student: Types.ObjectId;
  title: string;
  subject: string;
  type: 'assignment' | 'exam' | 'notice' | 'project';
  deadline: Date;
  source: string;
  confidence: number;
  lowConfidenceFields: string[];
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<PersonalDeadlineDoc>(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['assignment', 'exam', 'notice', 'project'],
      default: 'notice',
    },
    deadline: { type: Date, required: true, index: true },
    source: { type: String, default: 'from notice' },
    confidence: { type: Number, default: 1.0 },
    lowConfidenceFields: { type: [String], default: [] },
  },
  { timestamps: true }
);

schema.index({ student: 1, deadline: 1 });

export const PersonalDeadline: Model<PersonalDeadlineDoc> =
  model<PersonalDeadlineDoc>('PersonalDeadline', schema);
