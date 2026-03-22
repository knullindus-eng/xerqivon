async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "request failed");
  }

  return data;
}

export const api = {
  getStatus() {
    return request("/api/status");
  },

  login(password) {
    return request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
  },

  logout() {
    return request("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  addApp(payload) {
    return request("/api/apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  addMail(payload) {
    return request("/api/mails", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  bulkAddApps(apps) {
    return request("/api/apps/bulk", {
      method: "POST",
      body: JSON.stringify({ apps }),
    });
  },

  bulkAddMails(mails) {
    return request("/api/mails/bulk", {
      method: "POST",
      body: JSON.stringify({ mails }),
    });
  },

  listApps() {
    return request("/api/apps");
  },

  listMailAccounts() {
    return request("/api/mail-accounts");
  },

  seed() {
    return request("/api/seed", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getTables() {
    return request("/api/db/tables");
  },

  getTable(name) {
    return request(`/api/db/table/${encodeURIComponent(name)}`);
  },

  wipeAllData() {
    return request("/api/db/data/all", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  },

  wipeTableData(name) {
    return request(`/api/db/data/${encodeURIComponent(name)}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  },

  dropTable(name) {
    return request(`/api/db/table/${encodeURIComponent(name)}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  },
};
