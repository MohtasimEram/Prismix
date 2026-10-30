import { ListMusic, Star } from 'lucide-react';
import { Artwork } from './Artwork';

interface PlaylistCoverProps {
  src: string | null;
  /** The pixel size it renders at (square). */
  size: number;
  /** Liked Music's own tile, which has no picture of its own. */
  liked?: boolean;
  radius?: number;
}

/**
 * A playlist's cover: its picture, or a plain tile where it has none (a playlist
 * made a moment ago, an empty one) so a list of them never has holes.
 */
export function PlaylistCover({ src, size, liked, radius = 6 }: PlaylistCoverProps) {
  const box = { width: size, height: size, borderRadius: radius };
  if (liked) {
    return (
      <span
        className="grid flex-none place-items-center text-white"
        style={{ ...box, background: 'linear-gradient(135deg, #4f46e5 0%, #9b8cff 100%)' }}
        aria-hidden="true"
      >
        <Star size={Math.round(size * 0.46)} fill="currentColor" strokeWidth={1.5} />
      </span>
    );
  }
  if (!src) {
    return (
      <span className="grid flex-none place-items-center bg-quaternary text-secondary" style={box} aria-hidden="true">
        <ListMusic size={Math.round(size * 0.46)} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <span className="block flex-none" style={{ width: size }}>
      <Artwork src={src} displayWidth={size} radius={radius} />
    </span>
  );
}
