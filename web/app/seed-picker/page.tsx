import { Suspense } from "react";
import { SeedPicker } from "./seed-picker";

export default function SeedPickerPage() {
  return (
    <Suspense>
      <SeedPicker />
    </Suspense>
  );
}
