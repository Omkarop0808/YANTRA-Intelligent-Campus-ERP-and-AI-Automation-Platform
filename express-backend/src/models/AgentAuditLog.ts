import { Schema, model, type Document, type Model, type Types } from 'mongoose';

export type AgentApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type AgentResultStatus = 'success' | 'error' | 'pending';

export interface AgentAuditLogDoc extends Document {
  userId?: Types.ObjectId;
  threadId: string;
  tool: string;
  args: Record<string, unknown>;
  approvalStatus: AgentApprovalStatus;
  resultStatus: AgentResultStatus;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<AgentAuditLogDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: false },
    threadId: { type: String, required: true, index: true },
    tool: { type: String, required: true, index: true },
    args: { type: Schema.Types.Mixed, default: {} },
    approvalStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },
    resultStatus: {
      type: String,
      enum: ['success', 'error', 'pending'],
      default: 'pending',
      index: true,
    },
    timestamp: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

schema.index({ timestamp: -1, tool: 1 });

export const AgentAuditLog: Model<AgentAuditLogDoc> = model<AgentAuditLogDoc>('AgentAuditLog', schema);
