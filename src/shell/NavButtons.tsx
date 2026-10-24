import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

/** Whether there is an earlier page in this session's history (react-router numbers each entry). */
function canGoBack(): boolean {
  const index = (window.history.state as { idx?: number } | null)?.idx;
  return typeof index === 'number' && index > 0;
}

const button =
  'grid h-full w-[34px] place-items-center text-secondary transition-colors duration-100 enabled:hover:bg-quinary enabled:hover:text-primary focus-visible:outline-none focus-visible:bg-quinary disabled:opacity-35';

/**
 * The back button at the top left of the window. Also Alt+Left (and the mouse's
 * back button, which the webview already handles). Disabled on the first page.
 */
export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  // The location changes with every navigation, which is when the answer can change.
  useLocation();
  const enabled = canGoBack();
  return (
    <button
      type="button"
      className={className ?? button}
      aria-label="Back"
      title="Back"
      disabled={!enabled}
      onClick={() => navigate(-1)}
    >
      <ChevronLeft size={20} strokeWidth={2.2} />
    </button>
  );
}
