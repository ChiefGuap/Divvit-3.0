import { Suspense } from "react";
import { StartupOnboarding } from "@/components/marketplace/StartupOnboarding";

export const metadata = { title: "Get started" };

export default function Page() {
  return <Suspense><StartupOnboarding /></Suspense>;
}
