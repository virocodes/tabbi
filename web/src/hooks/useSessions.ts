import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export interface SessionSummary {
  _id: string;
  sessionId: string;
  repo: string;
  title: string | null;
  status: "idle" | "starting" | "running" | "paused" | "error";
  isProcessing?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface UseSessionsResult {
  sessions: SessionSummary[];
  isLoading: boolean;
  error: string | null;
  deleteSession: (sessionId: string) => Promise<void>;
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "Just now";
}

export function useSessions(): UseSessionsResult {
  // Real-time subscription to sessions from Convex
  const sessions = useQuery(api.sessions.listUserSessions) ?? [];
  const deleteSessionMutation = useMutation(api.sessions.deleteSession);

  // Map Convex session format to expected format
  const mappedSessions: SessionSummary[] = sessions.map((s: any) => ({
    _id: s._id,
    sessionId: s.sessionId,
    repo: s.repo,
    title: s.title ?? null,
    status: s.status,
    isProcessing: s.isProcessing,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  const deleteSession = async (sessionId: string) => {
    await deleteSessionMutation({ sessionId });
  };

  return {
    sessions: mappedSessions,
    isLoading: sessions === undefined,
    error: null,
    deleteSession,
  };
}
