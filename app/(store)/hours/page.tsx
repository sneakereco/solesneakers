import Link from "next/link";
import { Clock3, MapPin } from "lucide-react";

import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { PICKUP_HOURS, PICKUP_SERVICE_AREAS } from "@/config/pickup";

export default function HoursPage() {
  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-24 pt-16 text-black sm:px-8 lg:px-12">
      <h1 className="text-center text-3xl font-normal uppercase tracking-[0.02em] sm:text-[2rem]">
        Hours &amp; Pickups
      </h1>
      <p className="mx-auto mt-8 max-w-[48rem] text-center text-base leading-7 text-zinc-600">
        Local meets are available by appointment at an agreed-upon business in the
        Winston-Salem, High Point, Kernersville, and Greensboro areas of North Carolina.
      </p>

      <div className="mx-auto mt-14 grid max-w-[70rem] grid-cols-1 gap-6 md:grid-cols-2">
        <section className="border border-zinc-300 bg-white px-7 py-8 sm:px-9 sm:py-10">
          <Clock3 className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-6 text-xl font-normal uppercase tracking-[0.02em]">
            Local Meet Hours
          </h2>
          <p className="mt-5 text-lg">{PICKUP_HOURS}</p>
          <p className="mt-4 text-sm leading-6 text-zinc-600">
            Meetups are scheduled in advance. Once a time is confirmed, we will provide
            the agreed-upon business location and meetup details.
          </p>
        </section>

        <section className="border border-zinc-300 bg-white px-7 py-8 sm:px-9 sm:py-10">
          <MapPin className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-6 text-xl font-normal uppercase tracking-[0.02em]">
            Service Area
          </h2>
          <ul className="mt-5 divide-y divide-zinc-200 border-y border-zinc-200">
            {PICKUP_SERVICE_AREAS.map((area) => (
              <li key={area} className="py-3 text-sm text-zinc-700">
                {area}, NC
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mx-auto mt-6 max-w-[70rem] border border-zinc-300 bg-white px-7 py-8 text-center sm:px-9">
        <h2 className="text-lg font-normal uppercase tracking-[0.02em]">
          Schedule a Local Meet
        </h2>
        <p className="mx-auto mt-4 max-w-[48rem] text-sm leading-6 text-zinc-600">
          Contact us with your preferred city, date, and time. We will confirm
          availability and coordinate a business location for the meetup.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
            {SUPPORT_EMAIL}
          </a>
          <a
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {INSTAGRAM_HANDLE}
          </a>
          <Link href="/contact" className="underline underline-offset-4">
            Contact form
          </Link>
        </div>
      </section>
    </div>
  );
}
