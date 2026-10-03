import {
  ArrowUpDown, BellRing, Car, Cctv, CircleCheck, ConciergeBell, Coffee, Dumbbell, Flower2, PartyPopper,
  ShowerHead, Snowflake, SquareParking, Stethoscope, Tv, UtensilsCrossed, WashingMachine, Waves, Wifi, Wine, Zap,
  type LucideIcon,
} from "lucide-react";

/* The amenities list's icon keys (190's seed), drawn here; a key nobody
   knows - every amenity added by hand - is a plain tick. */
const ICONS: Record<string, LucideIcon> = {
  "front-desk": ConciergeBell, ac: Snowflake, wifi: Wifi, parking: SquareParking,
  restaurant: UtensilsCrossed, "room-service": BellRing, breakfast: Coffee, laundry: WashingMachine,
  lift: ArrowUpDown, power: Zap, "hot-water": ShowerHead, tv: Tv, banquet: PartyPopper, pool: Waves,
  gym: Dumbbell, spa: Flower2, bar: Wine, cctv: Cctv, doctor: Stethoscope, pickup: Car,
};

export const amenityIcon = (key: string): LucideIcon => ICONS[key] ?? CircleCheck;
