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
import { PrefetchLink } from '@/components/PrefetchLink';
import type { CategoryGroup } from '@/data/music/types';
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

/** Only a plain `rgb(r, g, b)` (what the mapper makes) or #rgb/#rrggbb reaches a style attribute; anything else gets a neutral grey. */
const SAFE_COLOR = /^(?:rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|#(?:[0-9a-f]{3}|[0-9a-f]{6}))$/i;
const safeColor = (color: string | null | undefined) => (color && SAFE_COLOR.test(color) ? color : '#5a5a66');

/**
 * Browse Categories bricks (report §6): 16:9 tiles, radius 10, the title at
 * the bottom left. Coloured from YouTube's own stripe colour per mood/genre,
 * each with its own glyph, a soft light and a lift on hover.
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
            {group.categories.map((category) => {
              const Icon = iconFor(category.title);
              return (
                <li key={`${category.title}-${category.link.params}`}>
                  <PrefetchLink
                    to={browseHref(category.link)}
                    className="group/tile relative isolate flex aspect-video items-end overflow-hidden rounded-artwork-lg bg-[linear-gradient(155deg,color-mix(in_srgb,var(--tile-color)_88%,#fff)_0%,var(--tile-color)_45%,color-mix(in_srgb,var(--tile-color)_50%,#000)_100%)] px-3.5 py-3 text-white shadow-[0_1px_2px_#0000001f] transition-[scale,box-shadow] duration-200 ease-panel hover:scale-[1.025] hover:shadow-[0_10px_28px_color-mix(in_srgb,var(--tile-color)_45%,transparent)] focus-visible:scale-[1.025] motion-reduce:transition-none"
                    style={{ '--tile-color': safeColor(category.color) } as React.CSSProperties}
                  >
                    {/* A soft highlight from the top corner, and a faint sheen across the tile. */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 -z-1 bg-[radial-gradient(90%_80%_at_100%_0%,#ffffff40_0%,transparent_65%),linear-gradient(to_top,#00000040,transparent_55%)]"
                    />
                    {/* The glyph, large and cropped by the corner, turning slightly on hover. */}
                    <Icon
                      aria-hidden="true"
                      strokeWidth={1.4}
                      className="pointer-events-none absolute -top-2 -right-3 -z-1 size-[58%] rotate-12 text-white/30 transition-transform duration-300 ease-panel group-hover/tile:rotate-[18deg] group-hover/tile:scale-110 motion-reduce:transition-none"
                    />
                    <span className="line-clamp-2 type-title-2-emphasized [text-shadow:0_1px_8px_#0000004d]">{category.title}</span>
                  </PrefetchLink>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
