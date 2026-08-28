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

export const api = {
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

  oauthPending: (rq) => request(`/api/oauth/pending?rq=${encodeURIComponent(rq)}`),
  oauthConsent: (rq, allow) => request('/api/oauth/consent', { method: 'POST', body: { rq, allow } }),
  oauthGrants: () => request('/api/oauth/grants'),
  revokeGrant: (id) => request(`/api/oauth/grants/${id}`, { method: 'DELETE' }),

  apiKeys: () => request('/api/keys'),
  createApiKey: (name) => request('/api/keys', { method: 'POST', body: { name } }),
  revokeApiKey: (id) => request(`/api/keys/${id}`, { method: 'DELETE' }),

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
  deleteComment: (id, commentId) => request(`/api/recipes/${id}/comments/${commentId}`, { method: 'DELETE' }),
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

  plan: (start, end) => request(`/api/plan?start=${start}&end=${end}`),
  setPlanDay: (date, body) => request(`/api/plan/${date}`, { method: 'PUT', body }),

  pantry: () => request('/api/pantry'),
  addPantryItem: (location, text) => request('/api/pantry', { method: 'POST', body: { location, text } }),
  renamePantryItem: (id, text) => request(`/api/pantry/${id}`, { method: 'PATCH', body: { text } }),
  setPantryQty: (id, qty) => request(`/api/pantry/${id}`, { method: 'PATCH', body: { qty } }),
  removePantryItem: (id) => request(`/api/pantry/${id}`, { method: 'DELETE' }),
  savePantryInventory: (items) => request('/api/pantry', { method: 'PUT', body: { items } }),

  groceries: () => request('/api/groceries'),
  addGroceryItem: (text, section) => request('/api/groceries', { method: 'POST', body: { text, section } }),
  updateGroceryItem: (id, text, section) =>
    request(`/api/groceries/${id}`, { method: 'PATCH', body: { text, section } }),
  removeGroceryItem: (id) => request(`/api/groceries/${id}`, { method: 'DELETE' }),
};
