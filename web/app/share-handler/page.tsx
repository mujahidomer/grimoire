import { Suspense } from "react";
import { ShareHandler } from "./share-handler";

export default function ShareHandlerPage() {
  return (
    <Suspense>
      <ShareHandler />
    </Suspense>
  );
}
