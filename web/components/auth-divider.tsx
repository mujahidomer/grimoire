export function AuthDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-eco-border-light" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-eco-surface px-2 font-sans text-label-md text-eco-foreground/75">
          or
        </span>
      </div>
    </div>
  );
}
