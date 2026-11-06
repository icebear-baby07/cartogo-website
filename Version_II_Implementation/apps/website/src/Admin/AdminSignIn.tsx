import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import AdminDashboard from "./AdminDashboard";
import { supabase } from "../supabase";

type AuthView =
  | { status: "loading" | "signed-out" | "checking" }
  | { status: "authorized"; email: string }
  | { status: "denied" | "error"; message: string };

function responseMessage(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return undefined;
}

export default function AdminSignIn() {
  const [view, setView] = useState<AuthView>({ status: "loading" });
  const [signInPending, setSignInPending] = useState(false);
  const authorizedEmail = useRef<string | null>(null);

  useEffect(() => {
    document.title = "Admin sign-in — carTOGO.mnl";
  }, []);

  useEffect(() => {
    if (!supabase) {
      setView({
        status: "error",
        message: "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/website/.env.",
      });
      return;
    }

    let active = true;
    const verifySession = async (session: Session | null) => {
      if (!active) return;
      if (!session) {
        authorizedEmail.current = null;
        setView({ status: "signed-out" });
        return;
      }

      setView({ status: "checking" });
      try {
        const response = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = responseMessage(body) ?? "Could not verify admin access.";
          setView({
            status: response.status === 403 ? "denied" : "error",
            message,
          });
          return;
        }
        if (
          typeof body !== "object" ||
          body === null ||
          !("email" in body) ||
          typeof body.email !== "string"
        ) {
          throw new Error("The API returned an invalid identity response.");
        }
        authorizedEmail.current = body.email.toLowerCase();
        setView({ status: "authorized", email: body.email });
      } catch (error) {
        authorizedEmail.current = null;
        setView({
          status: "error",
          message: error instanceof Error ? error.message : "Could not verify admin access.",
        });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      if (event === "SIGNED_OUT") {
        authorizedEmail.current = null;
        setView({ status: "signed-out" });
        setSignInPending(false);
        return;
      }
      if (
        event === "SIGNED_IN" &&
        session?.user.email?.toLowerCase() === authorizedEmail.current
      ) return;
      queueMicrotask(() => void verifySession(session));
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn() {
    if (!supabase) return;
    setSignInPending(true);
    setView({ status: "signed-out" });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin` },
    });
    if (error) {
      setView({ status: "error", message: `Google sign-in failed: ${error.message}` });
      setSignInPending(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setView({ status: "error", message: `Could not sign out: ${error.message}` });
  }

  if (view.status === "authorized") {
    return <AdminDashboard email={view.email} onSignOut={() => void signOut()} />;
  }

  return (
    <main className="admin-auth-page login-screen">
      <section className="admin-auth-card login-card" aria-labelledby="admin-auth-title">
        <a className="logo" href="/">carTOGO.mnl</a>
        <h1 id="admin-auth-title">Admin sign-in</h1>
        {view.status === "loading" || view.status === "checking" ? (
          <p role="status" aria-live="polite">
            {view.status === "checking" ? "Verifying your Google account…" : "Checking sign-in status…"}
          </p>
        ) : null}
        {view.status === "signed-out" ? (
          <>
            <button
              className="button button-primary btn btn-primary btn-block"
              type="button"
              disabled={signInPending || !supabase}
              onClick={() => void signIn()}
            >
              {signInPending ? "Redirecting…" : "Sign in with Google"}
            </button>
            <p className="hint">Only Google accounts listed in Admin Settings can access the admin panel.</p>
          </>
        ) : null}
        {view.status === "denied" || view.status === "error" ? (
          <>
            <p className="admin-auth-error" role="alert">{view.message}</p>
            {view.status === "denied" && supabase ? (
              <button className="button button-ghost" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
