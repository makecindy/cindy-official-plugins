export type CommentSendResult =
  | { status: 'accepted' | 'queued'; commentIds: string[] }
  | { status: 'rejected' | 'unknown'; commentIds: string[] };

export function commentSendSucceeded(result: CommentSendResult): boolean {
  return result.status === 'accepted' || result.status === 'queued';
}

export function commentSendCompleted(
  result: CommentSendResult,
  commentId: string,
): boolean {
  return result.commentIds.includes(commentId);
}
