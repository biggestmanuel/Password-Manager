'use client';

import { useEffect, useState } from 'react';

const emptyEntryForm = { site: '', username: '', password: '', notes: '' };

export default function Home() {
  const [status, setStatus] = useState(null); // { vaultExists, loggedIn }
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    setChecking(true);
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    setStatus(data);
    setChecking(false);
  }

  if (checking) {
    return <Centered><p className="text-gray-400 text-sm">Loading...</p></Centered>;
  }

  if (!status.vaultExists) {
    return <Centered><AuthForm mode="setup" onDone={checkStatus} /></Centered>;
  }

  if (!status.loggedIn) {
    return <Centered><AuthForm mode="login" onDone={checkStatus} /></Centered>;
  }

  return <Vault onLoggedOut={checkStatus} />;
}

function Centered({ children }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function AuthForm({ mode, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const endpoint = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div>
        <h1 className="text-lg font-semibold">{mode === 'setup' ? 'Set your master password' : 'Unlock vault'}</h1>
        <p className="text-xs text-gray-400 mt-1">
          {mode === 'setup'
            ? 'This is hashed, never stored in plaintext. If you lose it, entries are unrecoverable — that is the point.'
            : 'Enter your master password to decrypt your vault.'}
        </p>
      </div>
      <input
        type="password"
        placeholder="Master password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        autoFocus
      />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded px-4 py-2 text-sm font-medium"
      >
        {mode === 'setup' ? 'Create vault' : 'Unlock'}
      </button>
    </form>
  );
}

function Vault({ onLoggedOut }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyEntryForm);
  const [editingId, setEditingId] = useState(null);
  const [revealedId, setRevealedId] = useState(null);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/entries');
      if (res.status === 401) return onLoggedOut();
      if (!res.ok) throw new Error('Failed to load entries');
      setEntries(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.site.trim() || !form.password) {
      setError('Site and password are required.');
      return;
    }

    try {
      if (editingId) {
        const res = await fetch(`/api/entries/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error('Failed to update entry');
        await loadEntries();
      } else {
        const res = await fetch('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error('Failed to create entry');
        await loadEntries();
      }
      setForm(emptyEntryForm);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteEntry(id) {
    const res = await fetch(`/api/entries/${id}`, { method: 'DELETE' });
    if (!res.ok) return setError('Failed to delete entry');
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  function startEdit(entry) {
    setEditingId(entry.id);
    setForm({ site: entry.site, username: entry.username || '', password: '', notes: entry.notes || '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyEntryForm);
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    onLoggedOut();
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Vault</h1>
          <p className="text-sm text-gray-400">{entries.length} entries</p>
        </div>
        <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white">
          Lock vault
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mb-8 space-y-3 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <input
          type="text"
          placeholder="Site (e.g. github.com)"
          value={form.site}
          onChange={(e) => setForm({ ...form, site: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        />
        <input
          type="text"
          placeholder="Username (optional)"
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder={editingId ? 'New password (leave blank to keep current)' : 'Password'}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={2}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 rounded px-4 py-2 text-sm font-medium">
            {editingId ? 'Save changes' : 'Add entry'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="bg-gray-700 hover:bg-gray-600 rounded px-4 py-2 text-sm">
              Cancel
            </button>
          )}
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </form>

      {loading && <p className="text-gray-400 text-sm">Loading...</p>}
      {!loading && entries.length === 0 && <p className="text-gray-500 text-sm">No entries yet.</p>}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="border border-gray-800 bg-gray-900 rounded-lg p-3">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium">{entry.site}</p>
                {entry.username && <p className="text-xs text-gray-400">{entry.username}</p>}
                <p className="text-xs font-mono mt-1 text-gray-300">
                  {revealedId === entry.id ? entry.password : '••••••••••'}
                </p>
                {entry.notes && <p className="text-xs text-gray-500 mt-1">{entry.notes}</p>}
              </div>
              <div className="flex gap-2 text-xs shrink-0 ml-3">
                <button
                  onClick={() => setRevealedId(revealedId === entry.id ? null : entry.id)}
                  className="text-gray-400 hover:text-white"
                >
                  {revealedId === entry.id ? 'Hide' : 'Reveal'}
                </button>
                <button onClick={() => startEdit(entry)} className="text-gray-400 hover:text-white">
                  Edit
                </button>
                <button onClick={() => deleteEntry(entry.id)} className="text-gray-400 hover:text-red-400">
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
