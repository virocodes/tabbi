import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./lib/auth-client";
import { LandingPage } from "./components/LandingPage";
import { LoginPage } from "./components/LoginPage";
import App from "./App";
import "./styles.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string, {
  verbose: true,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/app/*" element={<App />} />
      </Routes>
    </ConvexBetterAuthProvider>
  </BrowserRouter>
);
