import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { useAuth } from "../hooks/useAuth";
import { GitHubAuth } from "./GitHubAuth";

export function LoginPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signInWithGitHub, reposError } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Check if we're in the middle of an OAuth callback
  const isOAuthCallback = searchParams.has("ott") || searchParams.has("code");

  // Redirect to /app if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate("/app", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Show skeleton while checking auth OR processing OAuth callback (but not yet authenticated)
  if (isLoading || (isOAuthCallback && !isAuthenticated)) {
    return (
      <div className="auth-page">
        <div className="auth-content">
          <div className="auth-card">
            <div
              className="skeleton-box"
              style={{ width: "180px", height: "32px", margin: "0 auto 16px" }}
            />
            <div
              className="skeleton-box"
              style={{ width: "220px", height: "20px", margin: "0 auto 32px" }}
            />
            <div className="skeleton-box" style={{ width: "100%", height: "48px" }} />
          </div>
        </div>
      </div>
    );
  }

  // Already authenticated, will redirect
  if (isAuthenticated) {
    return null;
  }

  const handleSignIn = () => {
    setIsSigningIn(true);
    signInWithGitHub();
  };

  return <GitHubAuth onSignIn={handleSignIn} isLoading={isSigningIn} error={reposError} />;
}
