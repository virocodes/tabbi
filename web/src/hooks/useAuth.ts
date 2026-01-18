import { useState, useEffect } from "react";
import { useConvexAuth, useQuery, useAction } from "convex/react";
import { authClient } from "../lib/auth-client";
import { api } from "../../../convex/_generated/api";

export interface Repository {
  id: number;
  full_name: string;
  private: boolean;
  description: string | null;
}

export interface UserProfile {
  githubUsername: string;
  githubId: number;
  avatarUrl?: string;
  name?: string;
  email?: string;
}

export interface UseAuthResult {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: UserProfile | null | undefined;
  repos: Repository[];
  isLoadingRepos: boolean;
  reposError: string | null;
  signInWithGitHub: () => void;
  signOut: () => Promise<void>;
  refreshRepos: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const { isAuthenticated, isLoading } = useConvexAuth();

  // Get user profile from Convex
  const user = useQuery(
    api.users.getCurrentUser,
    isAuthenticated ? {} : "skip"
  );

  // Fetch repos action
  const fetchRepos = useAction(api.github.fetchUserRepos);

  // Local state for repos (fetched via action)
  const [repos, setRepos] = useState<Repository[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  // Fetch repos when authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      refreshRepos();
    }
  }, [isAuthenticated, isLoading]);

  const refreshRepos = async () => {
    if (!isAuthenticated) return;

    setIsLoadingRepos(true);
    setReposError(null);

    try {
      const fetchedRepos = await fetchRepos({});
      setRepos(fetchedRepos);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch repositories";
      setReposError(errorMessage);
      setRepos([]);
    } finally {
      setIsLoadingRepos(false);
    }
  };

  const signInWithGitHub = () => {
    authClient.signIn.social({
      provider: "github",
      callbackURL: "/app",
    });
  };

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  return {
    isAuthenticated,
    isLoading,
    user,
    repos,
    isLoadingRepos,
    reposError,
    signInWithGitHub,
    signOut: handleSignOut,
    refreshRepos,
  };
}
