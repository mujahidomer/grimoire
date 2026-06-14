import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-sans text-lg text-slate-600">
        That item isn&apos;t in your library.
      </p>
      <Link
        href="/"
        className="font-sans text-sm font-medium text-indigo-600 hover:underline"
      >
        ← Back to Library
      </Link>
    </div>
  );
}
