import { Types } from 'mongoose';
import { Submission } from '../models/Submission';
import { NotFound, BadRequest } from '../utils/http-errors';

const toId = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw BadRequest('Invalid identifier');
  return new Types.ObjectId(id);
};

export const tokenizeAndNormalize = (text: string): string[] => {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
};

export const shingleText = (text: string, n = 3): Set<string> => {
  const words = tokenizeAndNormalize(text);
  if (words.length === 0) return new Set();
  if (words.length < n) {
    return new Set([words.join(' ')]);
  }
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '));
  }
  return shingles;
};

export const computeJaccardSimilarity = (textA: string, textB: string, n = 3): number => {
  const normA = textA.trim();
  const normB = textB.trim();
  if (!normA && !normB) return 1.0;
  if (!normA || !normB) return 0.0;
  if (normA.toLowerCase() === normB.toLowerCase()) return 1.0;

  const sA = shingleText(normA, n);
  const sB = shingleText(normB, n);

  if (sA.size === 0 && sB.size === 0) return 1.0;
  if (sA.size === 0 || sB.size === 0) return 0.0;

  let intersection = 0;
  for (const item of sA) {
    if (sB.has(item)) intersection++;
  }
  const union = sA.size + sB.size - intersection;
  return union === 0 ? 0.0 : Math.round((intersection / union) * 1000) / 1000;
};

export const checkSubmissionSimilarity = async (
  submissionId: string,
  threshold = 0.70
) => {
  const subId = toId(submissionId);
  const targetSub = await Submission.findById(subId).populate('student', 'name email').lean();
  if (!targetSub) throw NotFound('Submission not found');

  const targetText = targetSub.textContent || targetSub.proposal?.notes || '';

  // Find all peer submissions for the same resource
  const peerSubs = await Submission.find({
    resource: targetSub.resource,
    _id: { $ne: subId },
  }).populate('student', 'name email').lean();

  let maxSimilarity = 0.0;
  let matchedPeer: any = null;

  for (const peer of peerSubs) {
    const peerText = peer.textContent || peer.proposal?.notes || '';
    if (!peerText) continue;

    const sim = computeJaccardSimilarity(targetText, peerText, 3);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      matchedPeer = {
        submissionId: peer._id.toString(),
        studentId: (peer.student as any)?._id?.toString() || (peer.student as any)?.toString(),
        studentName: (peer.student as any)?.name ?? 'Peer Student',
        studentEmail: (peer.student as any)?.email ?? '',
      };
    }
  }

  const isPlagiarismSuspected = maxSimilarity >= threshold;

  // If high similarity is detected, update submission proposal flag
  if (isPlagiarismSuspected) {
    const subDoc = await Submission.findById(subId);
    if (subDoc) {
      if (!subDoc.proposal) {
        subDoc.proposal = {
          proposedScore: subDoc.score ?? 0,
          rubricBreakdown: [],
          feedback: 'Automated check flagged high textual similarity with a peer submission.',
          flags: ['similarity_flagged', 'plagiarism_suspected'],
          proposedAt: new Date(),
          proposedBy: 'ai',
        };
      } else {
        if (!subDoc.proposal.flags.includes('similarity_flagged')) {
          subDoc.proposal.flags.push('similarity_flagged');
        }
        if (!subDoc.proposal.flags.includes('plagiarism_suspected')) {
          subDoc.proposal.flags.push('plagiarism_suspected');
        }
      }
      await subDoc.save();
    }
  }

  return {
    submissionId: subId.toString(),
    resourceId: targetSub.resource.toString(),
    targetStudentId: (targetSub.student as any)?._id?.toString() || (targetSub.student as any)?.toString(),
    similarityScore: maxSimilarity,
    isSimilarityFlagged: isPlagiarismSuspected,
    isPlagiarismSuspected,
    threshold,
    matchedPeer,
    comparisonsCount: peerSubs.length,
  };
};
