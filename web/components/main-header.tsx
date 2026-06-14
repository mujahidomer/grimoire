export function MainHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <h1 className="font-display text-[2rem] font-normal leading-tight text-eco-heading">
        {title}
      </h1>
      {actions}
    </div>
  );
}
