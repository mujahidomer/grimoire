export function MainHeader({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 lg:mb-8">
      <h1 className="font-display text-[1.625rem] font-normal leading-tight text-eco-heading lg:text-[2rem]">
        {title}
      </h1>
      {actions}
    </div>
  );
}
