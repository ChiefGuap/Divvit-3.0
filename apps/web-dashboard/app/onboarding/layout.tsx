/* Onboarding runs outside the dashboard shell.

   The shell is a signed-in surface — sidebar, venue switcher, live activity —
   and none of it means anything to someone who does not have an account yet.
   Rendering it around a signup would also show a nav that half-works. */

export const metadata = { title: "Get started — Divvit" };

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
