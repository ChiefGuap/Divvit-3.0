"use client";

/* Marketplace front door — one question, like the first screen of an onboarding. */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { useMp } from "./session";
import { Choices, FlowBar, Question } from "./flow";
import { Art } from "./art";

export function Welcome() {
  const { user, profile, loading } = useMp();
  const router = useRouter();

  React.useEffect(() => {
    if (!loading && user && profile) router.replace(profile.role === "cafe" ? "/cafes/inbox" : "/home");
  }, [loading, user, profile, router]);

  return (
    <>
      <FlowBar right={<Link href="/signin" className="mp-link">Sign in</Link>} />
      <div className="mp-slide in fwd">
      <Question title="How will you use Divvit?" sub="We'll set things up for you.">
        <Choices<"startup" | "cafe"> cols={1} big value={null} onChange={(v) => router.push(v === "cafe" ? "/start/cafe" : "/start/startup")} options={[
          { value: "startup", art: <Art name="rocket" />, label: "I'm a startup", hint: "Put my brand on coffee cups near my customers" },
          { value: "cafe", art: <Art name="store" />, label: "I run a café", hint: "Earn from the cups I already serve" },
        ]} />
      </Question>
      </div>
    </>
  );
}
