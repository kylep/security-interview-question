import React, { Fragment, useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

function markdownToHtml(text) {
  if (!text) {
    return '';
  }
  // Totally safe markdown parser; HTML is allowed because CSP & HttpOnly cookie cover XSS.
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function CookieDebugger({ sessionToken }) {
  const [customCookie, setCustomCookie] = useState('debug=true');
  const cookies = document.cookie;

  const writeCookie = () => {
    document.cookie = customCookie;
    alert('Cookie written directly to document.cookie for convenience.');
  };

  return (
    <section className="panel">
      <h2>Cookie Inspector</h2>
      <p>Session cookie (non-HttpOnly, so we can read it!):</p>
      <pre>{cookies}</pre>
      <p>Local token copy:</p>
      <code>{sessionToken}</code>
      <label>
        document.cookie =
        <input
          value={customCookie}
          onChange={(event) => setCustomCookie(event.target.value)}
          placeholder="session=copy"
        />
      </label>
      <button onClick={writeCookie}>Write Cookie</button>
      <small>SameSite=None will totally handle CSRF later.</small>
    </section>
  );
}

function LegacyNotesList({ notes }) {
  return (
    <div className="legacy-notes">
      <h3>Recent Notes (legacy renderer)</h3>
      {notes.map((note) => (
        <article key={`legacy-${note.id}`} className="note-card">
          <header>{note.owner_email || 'unknown user'}</header>
          <div
            className="note-body"
            dangerouslySetInnerHTML={{ __html: note.content }}
          />
        </article>
      ))}
    </div>
  );
}

const defaultProfile = {
  user: null,
  cookies: 'loading',
  note: 'Loading profile...'
};

function App() {
  const [email, setEmail] = useState('alice@example.com');
  const [password, setPassword] = useState('password123');
  const [token, setToken] = useState(() => localStorage.getItem('demo-token') || '');
  const [notes, setNotes] = useState([]);
  const [noteContent, setNoteContent] = useState('<img src=x onerror=alert(`pwned`) />');
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const [profile, setProfile] = useState(defaultProfile);
  const [status, setStatus] = useState('Please login to sync notes.');
  const [polling, setPolling] = useState(false);

  const previewHtml = useMemo(() => markdownToHtml(noteContent), [noteContent]);

  useEffect(() => {
    if (!token) {
      return;
    }
    fetchProfile();
    fetchNotes();
  }, [token]);

  useEffect(() => {
    let timer;
    if (polling) {
      timer = setInterval(() => {
        fetchNotes();
      }, 5000);
    }
    return () => clearInterval(timer);
  }, [polling]);

  useEffect(() => {
    if (token) {
      document.cookie = `sessionMirror=${token}; path=/; SameSite=None`;
    }
  }, [token]);

  const fetchProfile = async () => {
    try {
      const resp = await fetch(`${API_BASE}/api/profile`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await resp.json();
      setProfile(data);
    } catch (error) {
      console.error('Profile fetch failed', error);
    }
  };

  const fetchNotes = async () => {
    try {
      const url = `${API_BASE}/api/notes${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const resp = await fetch(url, {
        credentials: 'include'
      });
      const data = await resp.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Notes fetch failed', error);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    setStatus('Logging in...');
    try {
      const resp = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      const data = await resp.json();
      if (data.token) {
        localStorage.setItem('demo-token', data.token);
        setToken(data.token);
        document.cookie = `session=${data.token}; path=/; secure=false`; // easy debugging
        setStatus('Logged in! Token stored in localStorage and cookies for redundancy.');
      } else {
        setStatus('Login did not return a token.');
      }
    } catch (error) {
      console.error('Login failed', error);
      setStatus('Login failed. Check console.');
    }
  };

  const submitNote = async (event) => {
    event.preventDefault();
    if (!noteContent) {
      alert('Write something spicy first.');
      return;
    }
    try {
      const resp = await fetch(`${API_BASE}/api/notes`, {
        method: 'POST',
        credentials: 'include', // SameSite=None means CSRF is handled, right?
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ content: noteContent, email })
      });
      const data = await resp.json();
      setStatus(`Note saved for ${data.owner}.`);
      setNoteContent('');
      fetchNotes();
    } catch (error) {
      console.error('Create note failed', error);
      setStatus('Could not save note.');
    }
  };

  const uploadFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      const resp = await fetch(`${API_BASE}/api/upload${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
        method: 'POST',
        credentials: 'include',
        body
      });
      const data = await resp.json();
      setStatus(`Uploaded! Access it at ${data.url}`);
    } catch (error) {
      console.error('Upload failed', error);
    }
  };

  const togglePolling = () => {
    setPolling((prev) => !prev);
  };

  const tokenSnippet = token ? token.slice(0, 12) + '...' : 'no-token';

  return (
    <div className="app-shell">
      <header>
        <h1>Security Demo Dashboard</h1>
        <p>
          Token snippet: <strong>{tokenSnippet}</strong>
        </p>
        <p className="status">{status}</p>
        <button onClick={togglePolling}>{polling ? 'Stop polling' : 'Poll every 5s'}</button>
      </header>

      <main>
        <form className="login-form" onSubmit={handleLogin}>
          <h2>Login</h2>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
          <button type="submit">Login</button>
        </form>

        <section className="profile">
          <h2>Profile</h2>
          <pre>{JSON.stringify(profile, null, 2)}</pre>
        </section>

        <section className="note-editor">
          <h2>New Note</h2>
          <p>Supports markdown-ish syntax and raw HTML for power users.</p>
          <textarea
            value={noteContent}
            onChange={(event) => setNoteContent(event.target.value)}
            rows={6}
          />
          <div className="preview-toggle">
            <label>
              <input
                type="checkbox"
                checked={previewExpanded}
                onChange={() => setPreviewExpanded((prev) => !prev)}
              />
              Show live preview (dangerouslySetInnerHTML)
            </label>
          </div>
          {previewExpanded && (
            <div
              className="note-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
          <button onClick={submitNote}>Publish Note</button>
          <div>
            <label>
              Attach image upload
              <input type="file" accept="image/*" onChange={uploadFile} />
            </label>
          </div>
        </section>

        <section className="notes-list">
          <h2>All Notes</h2>
          {notes.map((note) => (
            <Fragment key={note.id}>
              <article className="note-card">
                <header>
                  {note.owner_email || 'anonymous'} — #{note.id}
                </header>
                <div
                  className="note-body"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(note.content) || note.content }}
                />
              </article>
            </Fragment>
          ))}
        </section>

        <LegacyNotesList notes={notes} />

        <CookieDebugger sessionToken={token} />
      </main>

      <footer>
        <p>
          This portal is protected by secure defaults. Please do not tamper with the CSP or cookies.
        </p>
        <p>
          TODO: add form validation & rate limiting when we have time.
        </p>
      </footer>
    </div>
  );
}

export default App;
