import { Suspense } from "react";
import { CafeOnboarding } from "@/components/marketplace/CafeOnboarding";

export const metadata = { title: "Join as a café" };

export default function Page() {
  return <Suspense><CafeOnboarding /></Suspense>;
}
