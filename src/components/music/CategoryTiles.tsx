import {
  CloudRain,
  Car,
  Coffee,
  Disc3,
  Drum,
  Dumbbell,
  Flame,
  Gamepad2,
  Globe,
  Guitar,
  Headphones,
  Heart,
  Leaf,
  Mic,
  Moon,
  Music,
  PartyPopper,
  Piano,
  Plane,
  Radio,
  Smile,
  Sparkles,
  Sun,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PrefetchLink } from '@/components/PrefetchLink';
import { useCategoryPoster } from '@/data/music/queries';
import type { Category, CategoryGroup } from '@/data/music/types';
import { Artwork } from './Artwork';
import { browseHref } from './links';

/** A glyph for a mood or genre, chosen from words in its title; a note when nothing matches. */
const ICONS: [RegExp, LucideIcon][] = [
  [/workout|gym|fitness|run|energy|power|sport/i, Dumbbell],
  [/party|dance|club|festival|celebrat/i, PartyPopper],
  [/sleep|night|chill out|calm|relax|ambient|dream/i, Moon],
  [/rain|sad|melanchol|blue|mellow/i, CloudRain],
  [/love|romance|romantic|heart/i, Heart],
  [/focus|study|work|concentrat|coffee|cafe|morning|jazz/i, Coffee],
  [/commute|drive|road|travel|car/i, Car],
  [/fly|vacation|holiday|summer|beach|sun/i, Sun],
  [/rock|metal|punk|guitar|indie|grunge/i, Guitar],
  [/hip.?hop|rap|trap|drill|beat/i, Mic],
  [/classical|piano|orchestra|instrumental/i, Piano],
  [/drum|percussion|reggae|latin|afro/i, Drum],
  [/electronic|edm|house|techno|dubstep|synth|trance/i, Zap],
  [/pop|happy|feel good|good vibes|smile|fun/i, Smile],
  [/radio|podcast|talk|new release/i, Radio],
  [/gaming|game/i, Gamepad2],
  [/nature|folk|country|acoustic|garden|forest/i, Leaf],
  [/world|global|k.?pop|j.?pop|bollywood|international|regional/i, Globe],
  [/angry|hype|fire|intense|aggress|hot/i, Flame],
  [/r&b|soul|funk|disco|90s|80s|70s|00s|retro|throwback|decade/i, Disc3],
  [/headphone|lofi|lo-fi|bass/i, Headphones],
  [/flight|plane/i, Plane],
  [/new|fresh|discover|trending|top|best/i, Sparkles],
];

function iconFor(title: string): LucideIcon {
  return ICONS.find(([pattern]) => pattern.test(title))?.[1] ?? Music;
}

/** Only a plain `rgb(r, g, b)` (what the mapper makes) or #rgb/#rrggbb reaches a style attribute. */
const SAFE_COLOR = /^(?:rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|#(?:[0-9a-f]{3}|[0-9a-f]{6}))$/i;

/** Spotify-bright colours, for a tile YouTube gives no usable colour (or only a grey) to. */
const PALETTE = ['#dc148c', '#2d46b9', '#8400e7', '#1e3264', '#608108', '#e13300', '#477d95', '#148a08', '#509bf5', '#8d67ab', '#e8115b', '#ba5d07', '#af2896', '#006450', '#e61e32', '#0d73ec'];

/** A small stable number from a title, so a tile keeps its colour and banner from visit to visit. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function parseColor(color: string): [number, number, number] | null {
  if (!SAFE_COLOR.test(color)) return null;
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  const [r = 0, g = 0, b = 0] = color.match(/\d+/g)!.map(Number);
  return [r, g, b];
}

/**
 * The tile's colour: YouTube's own stripe colour made vivid (full saturation, a middling lightness, so
 * white titles read on it), or one of the palette's when YouTube's is missing or nearly grey.
 */
function tileColor(color: string | null | undefined, title: string): string {
  const rgb = color ? parseColor(color) : null;
  if (rgb) {
    const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d > 0.12) {
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      return `hsl(${Math.round(h)} 78% 40%)`;
    }
  }
  return PALETTE[hash(title) % PALETTE.length]!;
}

/** Three patterns for the banner's face, so the tiles of a page are not all alike. */
const PATTERNS = [
  'radial-gradient(circle at 26% 28%, rgba(255,255,255,0.34) 0 27%, transparent 28%)',
  'repeating-linear-gradient(45deg, rgba(255,255,255,0.2) 0 7px, transparent 7px 14px)',
  'repeating-radial-gradient(circle at 72% 74%, rgba(255,255,255,0.28) 0 5px, transparent 5px 11px)',
];

/** True once [element] has come near the screen, and stays true: a page of tiles reads only the ones scrolled to. */
function useNearScreen(): [React.RefObject<HTMLLIElement | null>, boolean] {
  const ref = useRef<HTMLLIElement | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === 'undefined') return setNear(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

function CategoryTile({ category }: { category: Category }) {
  const [ref, near] = useNearScreen();
  const poster = useCategoryPoster(category.link, near).data ?? null;
  const Icon = iconFor(category.title);
  const pattern = PATTERNS[hash(category.title) % PATTERNS.length]!;
  return (
    <li ref={ref}>
      <PrefetchLink
        to={browseHref(category.link)}
        className="group/tile relative isolate block aspect-video overflow-hidden rounded-artwork-lg bg-(--tile-color) p-3.5 text-white shadow-[0_1px_2px_#0000001f] transition-[scale,box-shadow] duration-200 ease-panel hover:scale-[1.025] hover:shadow-[0_10px_28px_color-mix(in_srgb,var(--tile-color)_45%,transparent)] focus-visible:scale-[1.025] motion-reduce:transition-none"
        style={{ '--tile-color': tileColor(category.color, category.title) } as React.CSSProperties}
      >
        <span className="relative line-clamp-2 max-w-[74%] type-[700_24px/28px] tracking-[-0.01em] max-lg:type-[700_21px/25px] max-[607px]:type-[700_17px/21px]">{category.title}</span>
        {/* The banner: tilted, hanging off the bottom-right corner, carrying the poster (a glyph until there is one). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[-5%] bottom-[-14%] -z-1 grid aspect-square h-[74%] rotate-[24deg] place-items-center overflow-hidden rounded-[6px] shadow-[0_6px_18px_#0000005c] transition-transform duration-300 ease-panel group-hover/tile:rotate-[30deg] group-hover/tile:scale-105 motion-reduce:transition-none"
          style={{
            backgroundImage: `${pattern}, linear-gradient(135deg, color-mix(in srgb, var(--tile-color) 52%, #fff), color-mix(in srgb, var(--tile-color) 60%, #000))`,
          }}
        >
          {poster ? (
            <span className="absolute inset-0">
              <Artwork src={poster} displayWidth={160} />
            </span>
          ) : (
            <Icon strokeWidth={1.6} className="size-[46%] text-white/90 drop-shadow-[0_2px_4px_#0000004d]" />
          )}
        </span>
      </PrefetchLink>
    </li>
  );
}

/**
 * Browse Categories bricks (report §6), as Spotify's Browse all: 16:9 tiles in a flat, vivid colour, the
 * title at the top left, and a tilted square "banner" at the bottom right that the corner crops, carrying
 * the cover of a real playlist or album of the mood or genre (a glyph while it loads, or when it has none). The banner tilts a little more on hover, with a lift.
 */
export function CategoryTiles({ groups }: { groups: CategoryGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.title} className="pt-3" aria-label={group.title}>
          <div className="mx-(--body-gutter) flex items-baseline gap-2.5">
            <h2 className="type-title-2-emphasized">{group.title}</h2>
            <span className="type-callout text-tertiary">{group.categories.length}</span>
          </div>
          {/* 4 columns at ≥1000px, gap 20px (report §6); 3, then 2, below. */}
          <ul className="mx-(--body-gutter) mt-3 mb-8 grid grid-cols-4 gap-5 max-lg:grid-cols-3 max-[607px]:grid-cols-2 max-[607px]:gap-2.5">
            {group.categories.map((category) => (
              <CategoryTile key={`${category.title}-${category.link.params}`} category={category} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
