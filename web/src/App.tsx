import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, useNavigate, useParams, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { useSessions } from "./hooks/useSessions";
import { useSession } from "./hooks/useSession";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./components/HomePage";
import { Chat } from "./components/Chat";

function AppContent() {
  const navigate = useNavigate();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();

  const {
    isAuthenticated,
    isLoading: isAuthLoading,
    user,
    repos,
    isLoadingRepos,
    signOut,
  } = useAuth();

  const {
    sessions,
    deleteSession,
  } = useSessions();

  // Callback to update sidebar session status in real-time
  const handleStatusChange = useCallback(
    (_sessionId: string, _status: "idle" | "starting" | "running" | "paused" | "error", _isProcessing: boolean) => {
      // Sessions are now real-time from Convex, no need to manually update
    },
    []
  );

  const {
    state: sessionState,
    isConnected,
    createSession,
    loadSession,
    clearSession,
    sendPrompt,
    error: sessionError,
  } = useSession({ onStatusChange: handleStatusChange });

  const [startupPhase, setStartupPhase] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  // Track pending messages per session ID (persists across re-renders)
  const pendingMessagesRef = useRef<Map<string, string>>(new Map());
  const [currentPendingMessage, setCurrentPendingMessage] = useState<string | null>(null);

  // Track if we've loaded the session from URL
  const loadedSessionRef = useRef<string | null>(null);

  // Load session from URL on mount or when URL changes
  useEffect(() => {
    if (urlSessionId && urlSessionId !== loadedSessionRef.current && isAuthenticated) {
      loadedSessionRef.current = urlSessionId;
      loadSession(urlSessionId);
    }
  }, [urlSessionId, isAuthenticated, loadSession]);

  // Clear loaded session ref when navigating away
  useEffect(() => {
    if (!urlSessionId) {
      loadedSessionRef.current = null;
    }
  }, [urlSessionId]);

  // Track startup phases and handle pending messages when session becomes ready
  useEffect(() => {
    if (sessionState?.status === "starting") {
      setStartupPhase("Sandbox starting...");
      setSessionReady(false);
    } else if (sessionState?.status === "running" && isConnected) {
      setStartupPhase(null);
      setSessionReady(true);

      // Check if there's a pending message for THIS session
      const sessionId = sessionState.sessionId;
      const pendingMessage = pendingMessagesRef.current.get(sessionId);
      if (pendingMessage) {
        sendPrompt(pendingMessage);
        pendingMessagesRef.current.delete(sessionId);
        setCurrentPendingMessage(null);
      }
    } else if (sessionState?.status === "error") {
      setStartupPhase(null);
      setSessionReady(false);
    }
  }, [sessionState?.status, sessionState?.sessionId, isConnected, sendPrompt]);

  // Navigate to session URL when session is created
  useEffect(() => {
    if (sessionState?.sessionId && sessionState.sessionId !== urlSessionId) {
      navigate(`/app/session/${sessionState.sessionId}`, { replace: true });
    }
  }, [sessionState?.sessionId, urlSessionId, navigate]);

  const handleLogout = useCallback(async () => {
    await signOut();
    navigate("/login");
  }, [signOut, navigate]);

  // Start session when user begins typing (preemptive startup)
  const handleStartTyping = useCallback(async (repo: string) => {
    if (!isAuthenticated) return;
    // Only start if we don't already have a session starting/running
    if (sessionState?.status === "starting" || sessionState?.status === "running") return;

    setStartupPhase("Creating sandbox...");
    setSessionReady(false);
    await createSession(repo);
  }, [isAuthenticated, sessionState?.status, createSession]);

  // Handle message submission
  const handleSubmitMessage = useCallback((message: string) => {
    if (sessionReady && isConnected && sessionState?.sessionId) {
      // Session is ready - send immediately
      sendPrompt(message);
    } else if (sessionState?.sessionId) {
      // Session not ready - store message for this specific session
      pendingMessagesRef.current.set(sessionState.sessionId, message);
      setCurrentPendingMessage(message);
    }
  }, [sessionReady, isConnected, sessionState?.sessionId, sendPrompt]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    // Restore pending message for this session if any
    const pendingMsg = pendingMessagesRef.current.get(sessionId);
    setCurrentPendingMessage(pendingMsg || null);
    navigate(`/app/session/${sessionId}`);
  }, [navigate]);

  const handleNewSession = useCallback(() => {
    clearSession();
    setSessionReady(false);
    setStartupPhase(null);
    setCurrentPendingMessage(null);
    loadedSessionRef.current = null;
    navigate("/app");
  }, [clearSession, navigate]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    // Clean up pending message for this session
    pendingMessagesRef.current.delete(sessionId);

    await deleteSession(sessionId);
    // If we deleted the active session, go back to home
    if (sessionId === urlSessionId) {
      setCurrentPendingMessage(null);
      navigate("/app");
    }
  }, [deleteSession, urlSessionId, navigate]);

  // Show skeleton while auth is initializing
  if (isAuthLoading) {
    return (
      <div className="app-layout">
        <div className="sidebar skeleton-sidebar">
          <div className="sidebar-header">
            <div className="skeleton-box" style={{ width: '120px', height: '24px' }} />
          </div>
          <div className="sidebar-sessions">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-session-item">
                <div className="skeleton-box" style={{ width: '100%', height: '16px', marginBottom: '8px' }} />
                <div className="skeleton-box" style={{ width: '60%', height: '12px' }} />
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="skeleton-box skeleton-avatar" />
          </div>
        </div>
        <div className="main-content">
          <div className="skeleton-main">
            <div className="skeleton-box" style={{ width: '200px', height: '32px', marginBottom: '24px' }} />
            <div className="skeleton-box" style={{ width: '100%', maxWidth: '600px', height: '48px' }} />
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Determine if we're on a session page
  const isSessionView = !!urlSessionId;

  // Main app layout with sidebar
  return (
    <div className="app-layout">
      <Sidebar
        sessions={sessions.map(s => ({
          sessionId: s.sessionId,
          repo: s.repo,
          firstMessage: s.title,
          status: s.status,
          isProcessing: s.isProcessing,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }))}
        activeSessionId={urlSessionId || null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onLogout={handleLogout}
        user={user ? { avatarUrl: user.avatarUrl, username: user.githubUsername } : undefined}
      />

      <div className="main-content">
        {sessionError && <div className="error-banner">{sessionError}</div>}

        {!isSessionView ? (
          <HomePage
            repos={repos}
            isLoadingRepos={isLoadingRepos}
            isStarting={sessionState?.status === "starting"}
            isReady={sessionReady}
            isPendingSubmit={currentPendingMessage !== null}
            startupPhase={startupPhase}
            onStartTyping={handleStartTyping}
            onSubmitMessage={handleSubmitMessage}
          />
        ) : (
          <Chat
            messages={sessionState?.messages || []}
            status={sessionState?.status || "starting"}
            repo={sessionState?.repo || ""}
            onSendPrompt={sendPrompt}
            pendingMessage={currentPendingMessage}
            startupPhase={startupPhase}
          />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppContent />} />
      <Route path="/session/:sessionId" element={<AppContent />} />
    </Routes>
  );
}

export default App;
