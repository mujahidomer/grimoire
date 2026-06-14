import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-8 py-24 text-center">
      <p className="font-display text-headline-lg font-light text-eco-foreground">
        That item isn&apos;t in your library.
      </p>
      <Link
        href="/"
        className="font-sans text-body-md font-medium text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
      >
        ← Back to Library
      </Link>
    </div>
  );
}
