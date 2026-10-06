/**
 * Public API surface. Flip `USE_MOCK` in `lib/config.ts` to switch between the
 * mock and the real backend — screens keep importing from `@/lib/api` either way.
 */
export {
  ApiError,
  type AddFriendResponse,
  type ApiConversation,
  type ApiFriend,
  type ApiFriendRequest,
  type ApiMessage,
  type ApiSnap,
  type ApiSnapSummary,
  type ApiSnapType,
  type ApiUser,
  type AuthResponse,
  type SendSnapInput,
  type Tokens,
} from '@/lib/api.types';

import * as mock from '@/lib/api.mock';
import * as real from '@/lib/api.real';
import { USE_MOCK } from '@/lib/config';

const api = USE_MOCK ? mock : real;

export const setAccessToken = api.setAccessToken;
export const setTokens = api.setTokens;
export const register = api.register;
export const login = api.login;
export const getFriends = api.getFriends;
export const getFriendRequests = api.getFriendRequests;
export const addFriend = api.addFriend;
export const deleteFriend = api.deleteFriend;
export const sendSnap = api.sendSnap;
export const getAccessToken = api.getAccessToken;
export const refreshSession = api.refreshSession;
export const getConversations = api.getConversations;
export const getMessages = api.getMessages;
export const sendMessage = api.sendMessage;
export const getInbox = api.getInbox;
export const getSnap = api.getSnap;
export const reportScreenshot = api.reportScreenshot;
