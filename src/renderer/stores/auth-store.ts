import { create } from 'zustand';
import type { AuthState } from '@shared/ipc-types';

const api = window.ravenforge;

/**
 * `null` on success, otherwise the main-process error message to show the user
 * — empty when the failure carried none, which the caller localizes. Returning
 * it rather than swallowing it is the point: main logs the reason and throws,
 * and without this the user clicked a button and saw nothing happen at all.
 */
type AuthResult = Promise<string | null>;

interface AuthStore extends AuthState {
  load: () => Promise<void>;
  loginMicrosoft: () => AuthResult;
  loginOffline: (username: string) => AuthResult;
  logout: (accountId: string) => Promise<void>;
  setActive: (accountId: string) => Promise<void>;
  refresh: (accountId: string) => AuthResult;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  isAuthenticating: false,

  load: async () => {
    const result = await api.auth.getState();
    if (result.success && result.data) {
      set({
        accounts: result.data.accounts,
        activeAccountId: result.data.activeAccountId,
        credentialsInPlaintext: result.data.credentialsInPlaintext,
        credentialsFile: result.data.credentialsFile,
      });
    }
  },

  loginMicrosoft: async () => {
    set({ isAuthenticating: true });
    try {
      const result = await api.auth.loginMicrosoft();
      if (!result.success) return result.error ?? '';
      await get().load();
      return null;
    } finally {
      set({ isAuthenticating: false });
    }
  },

  loginOffline: async (username: string) => {
    set({ isAuthenticating: true });
    try {
      const result = await api.auth.loginOffline(username);
      if (!result.success) return result.error ?? '';
      await get().load();
      return null;
    } finally {
      set({ isAuthenticating: false });
    }
  },

  logout: async (accountId: string) => {
    await api.auth.logout(accountId);
    await get().load();
  },

  setActive: async (accountId: string) => {
    await api.auth.setActive(accountId);
    set({ activeAccountId: accountId });
  },

  refresh: async (accountId: string) => {
    const result = await api.auth.refresh(accountId);
    if (!result.success) return result.error ?? '';
    await get().load();
    return null;
  },
}));

// Main broadcasts this whenever it changes auth state on its own — most
// importantly the silent token refresh at launch time, which no UI action
// triggers. Without this the account list only ever updates by accident.
api.on('auth:state-changed', (state) => {
  useAuthStore.setState({
    accounts: state.accounts,
    activeAccountId: state.activeAccountId,
  });
});
