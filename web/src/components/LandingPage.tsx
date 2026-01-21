import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { FloatingCatChars } from "./FloatingCatChars";

export function LandingPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handlePlayClick = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleVideoClick = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  return (
    <div className="landing-page">
      <FloatingCatChars catPosition={{ x: 0.18, y: 0.36 }} catScale={0.7} />

      <header className="landing-header">
        <div className="landing-logo">
          <span className="logo-emoticon">
            {">"}⩊{"<"}
          </span>
          <span>tabbi</span>
        </div>
        {isLoading ? (
          <span className="landing-nav-link">...</span>
        ) : isAuthenticated ? (
          <Link to="/app" className="landing-nav-link">
            <span className="auth-indicator" />
            Open app
          </Link>
        ) : (
          <Link to="/login" className="landing-nav-link">
            Log in
          </Link>
        )}
      </header>

      <main className="landing-main">
        <div className="landing-hero">
          <h1>Ship PRs while you sleep</h1>
          <p>
            Autonomous coding agents that work in parallel, turning your ideas into production code
            around the clock
          </p>
          <Link to={isAuthenticated ? "/app" : "/login"} className="landing-cta">
            Get started
          </Link>
        </div>

        <div className="landing-video-container">
          <video
            ref={videoRef}
            className="landing-video"
            src="/demo.mp4"
            autoPlay
            muted
            loop
            playsInline
            onClick={handleVideoClick}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
          {!isPlaying && (
            <button className="landing-video-play" onClick={handlePlayClick}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
