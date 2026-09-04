"use client";

/* Step 1 — create the account.

   Deliberately short. Everything else the product needs is either already in
   the roster or asked for later, and a long first screen is where signups
   die. */

import React from "react";
import { useRouter } from "next/navigation";
import { BigField, StepShell } from "@/components/onboarding/Chrome";
import { useDraft } from "@/components/onboarding/draft";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountStep() {
  const router = useRouter();
  const [draft, update, loaded] = useDraft();
  const [email, setEmail] = React.useState("");
  // Held in component state only, never written to the draft — see draft.ts.
  const [password, setPassword] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => { if (loaded && draft.email) setEmail(draft.email); },
                  [loaded, draft.email]);

  const emailOk = EMAIL_RE.test(email);
  const pwOk = password.length >= 8;
  const ready = emailOk && pwOk && agreed;

  function next() {
    setTouched(true);
    if (!ready) return;
    update({ email });
    router.push("/onboarding/venue");
  }

  return (
    <StepShell
      current="account"
      eyebrow="Let's get started"
      title="Create your Divvit account"
      blurb="Free to set up. Your venue is probably already in our roster with its brand health measured — we'll find it in the next step."
      onNext={next}
      nextDisabled={!ready}
      back={false}
    >
      <BigField label="Work email" value={email} onChange={setEmail} autoFocus
        hint={touched && !emailOk ? "That doesn't look like an email address." : undefined} />
      <BigField label="Create a password" value={password} onChange={setPassword}
        type="password"
        hint={touched && !pwOk ? "At least 8 characters." : "At least 8 characters."} />

      <label style={{ display: "flex", alignItems: "flex-start", gap: 11, marginTop: 20,
                      fontSize: 14, lineHeight: 1.55, cursor: "pointer" }}>
        <input type="checkbox" checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ marginTop: 2, width: 17, height: 17, accentColor: "var(--purple)" }} />
        <span style={{ color: "var(--text-secondary)" }}>
          I agree to Divvit&apos;s{" "}
          <a href="#" style={{ color: "var(--purple-deep)", fontWeight: 600 }}>Terms</a> and{" "}
          <a href="#" style={{ color: "var(--purple-deep)", fontWeight: 600 }}>Privacy Policy</a>.
        </span>
      </label>

      <p style={{ margin: "28px 0 0", fontSize: 13.5, color: "var(--text-muted)" }}>
        Already have an account?{" "}
        <a href="#" style={{ color: "var(--purple-deep)", fontWeight: 600 }}>Sign in</a>.
      </p>
    </StepShell>
  );
}
