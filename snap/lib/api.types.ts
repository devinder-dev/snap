/**
 * Shared types + the error class both the mock and the real client throw.
 *
 * Screens catch `ApiError` and render `e.message` verbatim — that only works if
 * mock and real throw the *same* class, not two lookalikes.
 */

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ApiUser = { username: string; created_at: string };

export type Tokens = { access_token: string; refresh_token: string };

export type AuthResponse = {
  tokens: Tokens;
  user: ApiUser;
};

export type ApiFriend = { username: string; created_at: string; mutual: boolean };

/** Someone who added you; they are not in GET /friends until you add them back. */
export type ApiFriendRequest = { username: string; created_at: string };

export type AddFriendResponse = { status: 'pending' | 'friends' };

export type SendSnapInput = {
  recipients: string[];
  photo: { uri: string; mimetype: string };
  text?: string;
};

/** One chat message. Newest first whenever it comes back in a list. */
export type ApiMessage = {
  id: string;
  sender_username: string;
  recipient_username: string;
  body: string;
  created_at: string;
};

/** A row in the conversation list: who it's with, and the newest message. */
export type ApiConversation = { username: string; last_message: ApiMessage };

export type ApiSnapType = 'text' | 'photo';

/** An inbox entry. Metadata only — listing the inbox never burns a snap. */
export type ApiSnapSummary = {
  id: string;
  type: ApiSnapType;
  sender_username: string;
  created_at: string;
  expires_at: string;
};

/**
 * A snap, read in full. Reading is ONE-SHOT: the server marks it viewed in the
 * same request, so a second `getSnap` for the same id is a 404.
 */
export type ApiSnap = ApiSnapSummary & {
  /** Caption on a photo, the content of a text snap. */
  body?: string;
  /** Presigned, expires after 5 minutes. Missing if the upload never landed. */
  media_url?: string;
};
