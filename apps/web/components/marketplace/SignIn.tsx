"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { AuthPanel } from "./AuthPanel";

export function SignIn() {
  const { user, profile } = useMp();
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = React.useState<"startup" | "cafe">("startup");

  React.useEffect(() => {
    if (user && profile) router.replace(profile.role === "cafe" ? "/cafes/inbox" : "/startups/campaigns");
  }, [user, profile, router]);

  return (
    <div className="mp-page mp-narrow" style={{ maxWidth: 520 }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div className="mp-eyebrow">Divvit Marketplace</div>
        <h1 className="mp-title">Welcome back</h1>
      </div>
      {params.get("error") === "confirm" && <div className="mp-error" style={{ marginBottom: 12 }}>That confirmation link didn&apos;t work — it may have expired. Sign in, or create the account again.</div>}
      <div className="mp-seg" style={{ width: "100%", marginBottom: 12 }}>
        <button style={{ flex: 1 }} className={role === "startup" ? "on" : ""} onClick={() => setRole("startup")}>I&apos;m a startup</button>
        <button style={{ flex: 1 }} className={role === "cafe" ? "on" : ""} onClick={() => setRole("cafe")}>I run a café</button>
      </div>
      <AuthPanel key={role} role={role} defaultMode="signin" />
    </div>
  );
}
