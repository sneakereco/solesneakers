import Image from "next/image";
import Link from "next/link";

import { FeaturedItems } from "@/components/home/FeaturedItems";

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
            <h1 className="max-w-4xl text-[2.5rem] font-bold uppercase italic leading-[0.9] tracking-[-0.05em] text-white sm:text-[3.5rem] lg:text-[4.55rem] xl:text-[5rem]">
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

      <FeaturedItems />
    </div>
  );
}
