type PolicyPageProps = {
  title: string;
  children: React.ReactNode;
};

export function PolicyPage({ title, children }: PolicyPageProps) {
  return (
    <article className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-24 pt-20 text-black sm:px-8 lg:px-12">
      <h1 className="text-center text-3xl font-normal uppercase tracking-[0.015em] sm:text-[2rem]">
        {title}
      </h1>
      <div className="policy-content mx-auto mt-16 max-w-[53rem]">{children}</div>
    </article>
  );
}
