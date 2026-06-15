import { Suspense } from "react";
import { Landing } from "./landing";

export default function LandingPage() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
