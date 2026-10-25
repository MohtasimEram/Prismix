import { Check, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/share';
import { detailButton } from './DetailHeader';

/**
 * Share, in a page header: copies [url]. A note under the button says it did,
 * and for a private playlist (a link only its owner can open) says that too.
 */
export function ShareButton({ url, label = 'Share', isPrivate = false }: { url: string; label?: string; isPrivate?: boolean }) {
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const share = async () => {
    const ok = await copyText(url);
    setNote({
      ok,
      text: !ok
        ? 'Couldn’t copy the link.'
        : isPrivate
          ? 'Link copied. This playlist is private, so nobody else will be able to open it.'
          : 'Link copied.',
    });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), isPrivate || !ok ? 5000 : 2200);
  };

  return (
    <span className="relative">
      <button className={detailButton.circle} aria-label={label} title={label} onClick={() => void share()}>
        {note?.ok ? <Check size={16} strokeWidth={2.4} /> : <Link2 size={16} strokeWidth={2.2} />}
      </button>
      {note && (
        <span
          role="status"
          className="absolute top-full left-1/2 z-10 mt-2 w-max max-w-[260px] -translate-x-1/2 rounded-[8px] bg-thick-material px-2.5 py-1.5 text-start type-callout text-primary shadow-[0_0_0_0.5px_var(--vibrantDivider),0_6px_24px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)] max-md:left-0 max-md:translate-x-0"
        >
          {note.text}
        </span>
      )}
    </span>
  );
}
