// src/config/pickup.ts

export const PICKUP_LOCATION_SUMMARY = "Winston-Salem, NC";

export const PICKUP_HOURS = "Daily, 10:00 AM - 9:00 PM";

export const PICKUP_SERVICE_AREAS = [
  "Winston-Salem",
  "High Point",
  "Kernersville",
  "Greensboro",
] as const;

export const PICKUP_INSTRUCTIONS = [
  "Pickup is by appointment only. Reply to this email to schedule a time.",
  "Bring a government-issued ID and your order number.",
  "The agreed-upon business location is shared after the meetup time is confirmed.",
  "If you need to reschedule, reply here and we will coordinate.",
];
