import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Replace with the published iCloud Shortcut link once the Shortcut is built.
const SHORTCUT_URL = "SHORTCUT_URL_HERE";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50">
      {children}
    </h2>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 font-sans text-body-md text-eco-foreground/70 transition-colors duration-eco hover:text-eco-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <h1 className="mb-8 font-display text-2xl text-eco-heading">Settings</h1>

      <section>
        <SectionHeading>Save from Anywhere</SectionHeading>

        <div className="space-y-4">
          <div className="rounded-xl border border-eco-border-light bg-eco-surface p-5 shadow-eco-sm">
            <h3 className="mb-1.5 font-sans text-body-md font-medium text-eco-on-surface">
              Android
            </h3>
            <p className="font-sans text-body-md text-eco-foreground/70">
              Install Grimoire in Chrome, then use the Share button in any app
              to save directly to Grimoire.
            </p>
          </div>

          <div className="rounded-xl border border-eco-border-light bg-eco-surface p-5 shadow-eco-sm">
            <h3 className="mb-1.5 font-sans text-body-md font-medium text-eco-on-surface">
              iOS
            </h3>
            <p className="mb-4 font-sans text-body-md text-eco-foreground/70">
              Add the Grimoire Shortcut, then use the Share button in any app to
              save directly to Grimoire.
            </p>
            <a
              href={SHORTCUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-surface border border-black/[0.12] bg-eco-surface px-4 py-2 font-sans text-body-md font-medium text-eco-on-surface transition-colors duration-eco hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary focus-visible:ring-offset-2"
            >
              Add iOS Shortcut
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
