import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { useAuth } from "../hooks/useAuth";
import { GitHubAuth } from "./GitHubAuth";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signInWithGitHub, reposError } = useAuth();
  const navigate = useNavigate();

  // Redirect to /app if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate("/app", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Show nothing while checking auth (brief flash)
  if (isLoading) {
    return (
      <div className="auth-page">
        <div className="auth-content">
          <div className="auth-card">
            <div className="skeleton-box" style={{ width: '180px', height: '32px', margin: '0 auto 16px' }} />
            <div className="skeleton-box" style={{ width: '220px', height: '20px', margin: '0 auto 32px' }} />
            <div className="skeleton-box" style={{ width: '100%', height: '48px' }} />
          </div>
        </div>
      </div>
    );
  }

  // Already authenticated, will redirect
  if (isAuthenticated) {
    return null;
  }

  return (
    <GitHubAuth
      onSignIn={signInWithGitHub}
      isLoading={false}
      error={reposError}
    />
  );
}
