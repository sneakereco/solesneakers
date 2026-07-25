import Image from "next/image";
import Link from "next/link";

import { FeaturedItems } from "@/components/home/FeaturedItems";

const categories = [
  {
    slug: "sneakers",
    label: "Sneakers",
    accent: "from-stone-100 via-zinc-300 to-zinc-700",
  },
  {
    slug: "clothing",
    label: "Clothing",
    accent: "from-[#e8d8c3] via-[#b58d68] to-[#3f2b1f]",
  },
  {
    slug: "accessories",
    label: "Accessories",
    accent: "from-[#d7e1d5] via-[#7d8d78] to-[#1d261d]",
  },
  {
    slug: "electronics",
    label: "Electronics",
    accent: "from-[#d8d4ff] via-[#6b6f9c] to-[#141722]",
  },
];

export default function HomePage() {
  return (
    <div className="bg-black">
      <section
        className="relative overflow-hidden bg-black text-white"
        style={{ height: "min(66vh, 720px)" }}
      >
        <Image
          src="/images/hero.jpg"
          alt="Solesneakers inventory stacked in a trunk"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[50%_34%]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.18)_34%,rgba(0,0,0,0.42)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(0,0,0,0.42),transparent_30%),linear-gradient(90deg,rgba(0,0,0,0.48)_18%,rgba(0,0,0,0.14)_46%,rgba(0,0,0,0.16)_100%)]" />

        <div className="relative z-10 flex h-full w-full items-end justify-center px-5 pb-20 pt-16 text-center sm:px-6 sm:pb-24 lg:px-8 lg:pb-28">
          <div className="max-w-[44rem] text-center">
            <h1 className="max-w-4xl text-[2.5rem] font-bold italic uppercase leading-[0.9] tracking-[-0.05em] text-white sm:text-[3.5rem] lg:text-[4.55rem] xl:text-[5rem]">
              Curated heat.
              <br />
              Available now.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm text-white/80 sm:text-base">
              Ready-to-ship pairs sourced with care and authenticity.
            </p>

            <div className="mt-8 flex justify-center">
              <Link
                href="/store"
                className="inline-flex min-w-[190px] items-center justify-center rounded-full bg-white px-9 py-4 text-sm font-semibold uppercase tracking-[0.24em] text-black shadow-[0_20px_40px_rgba(0,0,0,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-200 sm:min-w-[210px]"
              >
                Shop Now
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-black pb-16 pt-8 md:pb-20 md:pt-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between">
            <div>
              <div className="text-[0.68rem] uppercase tracking-[0.34em] text-zinc-500">
                Featured product
              </div>
              <h2 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
                Latest pairs on deck
              </h2>
            </div>
          </div>
          <FeaturedItems />
        </div>
      </section>

      <section className="bg-black pb-12 md:pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-end justify-between md:mb-8">
            <div>
              <div className="text-[0.68rem] uppercase tracking-[0.34em] text-zinc-500">
                Browse
              </div>
              <h2 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
                Shop by category
              </h2>
              <p className="mt-2 text-sm text-zinc-400 md:text-base">
                Keep the storefront fast: get to the section you want immediately.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/store?category=${category.slug}`}
                aria-label={`Shop ${category.label}`}
                className="group relative overflow-hidden rounded-[2rem] border border-zinc-800 bg-black shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
              >
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${category.accent} transition-transform duration-500 group-hover:scale-110`}
                />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.32),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.18),transparent_26%)]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/5" />
                <div className="relative flex h-48 flex-col justify-end p-5 sm:h-56 lg:h-64">
                  <h3 className="text-xl font-semibold text-white">{category.label}</h3>
                  <p className="mt-1 text-sm text-zinc-300 transition-colors group-hover:text-white">
                    Explore now
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
