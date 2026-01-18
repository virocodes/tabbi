import { useState, useMemo } from "react";
import { formatRelativeTime } from "../hooks/useSessions";

export interface SessionSummary {
  sessionId: string;
  repo: string;
  firstMessage: string | null;
  status: "idle" | "starting" | "running" | "paused" | "error";
  isProcessing?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * SessionStatusIndicator - Shows pulsing indicator only for active states
 * - Green pulsing: processing (actively working)
 * - Yellow pulsing: starting (sandbox spinning up)
 * - No indicator for: idle, running-but-idle, paused, error
 */
function SessionStatusIndicator({
  status,
  isProcessing,
}: {
  status: SessionSummary["status"];
  isProcessing?: boolean;
}) {
  // Only show indicator for processing or starting states
  if (status === "running" && isProcessing) {
    return <span className="session-status-dot processing" />;
  }
  if (status === "starting") {
    return <span className="session-status-dot starting" />;
  }
  // No indicator for other states
  return null;
}

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onLogout: () => void;
  user?: {
    avatarUrl?: string;
    username: string;
  };
}

interface DeleteConfirmState {
  isOpen: boolean;
  sessionId: string | null;
  sessionTitle: string;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onLogout,
  user,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    isOpen: false,
    sessionId: null,
    sessionTitle: "",
  });

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const query = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.repo.toLowerCase().includes(query) ||
        (s.firstMessage && s.firstMessage.toLowerCase().includes(query))
    );
  }, [sessions, searchQuery]);

  const getSessionTitle = (session: SessionSummary): string => {
    if (session.firstMessage) {
      return session.firstMessage.length > 45
        ? session.firstMessage.substring(0, 45) + "..."
        : session.firstMessage;
    }
    return session.repo.split("/").pop() || session.repo;
  };

  const openDeleteConfirm = (session: SessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm({
      isOpen: true,
      sessionId: session.sessionId,
      sessionTitle: getSessionTitle(session),
    });
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirm({ isOpen: false, sessionId: null, sessionTitle: "" });
  };

  const handleConfirmDelete = () => {
    if (deleteConfirm.sessionId) {
      // Close modal immediately for snappy UX
      const sessionIdToDelete = deleteConfirm.sessionId;
      closeDeleteConfirm();
      // Optimistic delete - onDeleteSession updates UI immediately
      onDeleteSession(sessionIdToDelete);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-emoticon">{">⩊<"}</span>
          <span>tabbi</span>
        </div>
      </div>

      <button className="new-session-btn" onClick={onNewSession}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New Session
      </button>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-sessions">
        {filteredSessions.length === 0 ? (
          <div className="sidebar-empty">
            {sessions.length === 0
              ? "No sessions yet"
              : "No matching sessions"}
          </div>
        ) : (
          filteredSessions.map((session) => (
            <div
              key={session.sessionId}
              className={`session-item ${activeSessionId === session.sessionId ? "active" : ""}`}
              onClick={() => onSelectSession(session.sessionId)}
            >
              <div className="session-item-header">
                <SessionStatusIndicator
                  status={session.status}
                  isProcessing={session.isProcessing}
                />
                <div className="session-item-title">{getSessionTitle(session)}</div>
              </div>
              <div className="session-item-meta">
                <span className="session-item-repo">{session.repo}</span>
                <span className="session-item-time">{formatRelativeTime(session.updatedAt)}</span>
              </div>
              <button
                className="session-item-delete"
                onClick={(e) => openDeleteConfirm(session, e)}
                title="Delete session"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        {user && (
          <div className="user-info">
            {user.avatarUrl && (
              <img src={user.avatarUrl} alt={user.username} className="user-avatar" />
            )}
            <span className="user-name">{user.username}</span>
          </div>
        )}
        <button className="logout-btn" onClick={onLogout}>
          Sign Out
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && (
        <div className="modal-overlay" onClick={closeDeleteConfirm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Delete Session</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this session?</p>
              <p className="modal-session-title">"{deleteConfirm.sessionTitle}"</p>
            </div>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={closeDeleteConfirm}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-delete" onClick={handleConfirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
