import { mockApi } from './mockApi.js';

// Static demo builds (GitHub Pages) run entirely in the browser
const DEMO = import.meta.env.VITE_DEMO === '1';

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const realApi = {
  config: () => request('/api/config'),
  me: () => request('/api/me'),
  authGoogle: (credential, inviteToken) => request('/api/auth/google', { method: 'POST', body: { credential, inviteToken } }),
  authDev: (name, email, inviteToken) => request('/api/auth/dev', { method: 'POST', body: { name, email, inviteToken } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  updateMe: (name) => request('/api/me', { method: 'PATCH', body: { name } }),
  uploadAvatar: (file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request('/api/me/avatar', { method: 'POST', body: fd });
  },
  removeAvatar: () => request('/api/me/avatar', { method: 'DELETE' }),

  inviteInfo: (token) => request(`/api/invites/${token}`),
  createInvite: (phone) => request('/api/invites', { method: 'POST', body: { phone } }),

  myRecipes: () => request('/api/recipes'),
  createRecipe: (body) => request('/api/recipes', { method: 'POST', body }),
  getRecipe: (id) => request(`/api/recipes/${id}`),
  updateRecipe: (id, body) => request(`/api/recipes/${id}`, { method: 'PATCH', body }),
  rateRecipe: (id, rating) => request(`/api/recipes/${id}`, { method: 'PATCH', body: { rating } }),
  deleteRecipe: (id) => request(`/api/recipes/${id}`, { method: 'DELETE' }),
  saveRecipe: (id) => request(`/api/recipes/${id}/save`, { method: 'POST' }),
  addComment: (id, text, photoFile) => {
    const fd = new FormData();
    fd.append('text', text);
    if (photoFile) fd.append('photo', photoFile);
    return request(`/api/recipes/${id}/comments`, { method: 'POST', body: fd });
  },
  addPhoto: (id, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request(`/api/recipes/${id}/photos`, { method: 'POST', body: fd });
  },
  removePhoto: (id, photoId) => request(`/api/recipes/${id}/photos/${photoId}`, { method: 'DELETE' }),

  friends: () => request('/api/friends'),
  friendRecipes: (id) => request(`/api/friends/${id}/recipes`),
  allFriendRecipes: () => request('/api/friends/recipes'),
  removeFriend: (id) => request(`/api/friends/${id}`, { method: 'DELETE' }),

  importUrl: (url) => request('/api/import', { method: 'POST', body: { url } }),
};

export const api = DEMO ? mockApi : realApi;
