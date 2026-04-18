"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { toast } from "sonner";
import { getClientAuth, isFirebaseConfigured } from "@/lib/firebase";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFirebaseConfigured()) {
      toast.error("Firebase is not configured", {
        description: "Add NEXT_PUBLIC_FIREBASE_* keys to `.env.local`.",
      });
      return;
    }
    const auth = getClientAuth();
    if (!auth) {
      toast.error("Auth client unavailable");
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      toast.success("Welcome back");
      router.replace("/admin");
    } catch {
      toast.error("Login failed", {
        description: "Check the Firebase user exists in Authentication.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <p className="text-xs uppercase tracking-[0.35em] text-[#d4af37]">
        Staff only
      </p>
      <h1 className="mt-3 font-serif text-3xl text-white">Concierge login</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Use the Firebase Auth email you provisioned for this studio console.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Email
          </label>
          <input
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            Password
          </label>
          <input
            type="password"
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none focus:border-[#d4af37]/60"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-gradient-to-r from-[#f3e2ad] via-[#d4af37] to-[#a67c00] py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0b0b0b]"
        >
          {busy ? "Signing in…" : "Enter console"}
        </button>
      </form>
    </div>
  );
}
