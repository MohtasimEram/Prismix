import { isDesktop, platform } from '@/desktop/tauri';
import { useWindowState, windowControls } from '@/desktop/window';
import { BackButton } from './NavButtons';

const os = platform();
/** Windows and Linux draw their own controls; macOS keeps its traffic lights over our bar. */
const ownControls = isDesktop() && os !== 'macos';

function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph({ restore }: { restore: boolean }) {
  return restore ? (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M2.5 2.5V.5h7v7h-2" />
      <rect x=".5" y="2.5" width="7" height="7" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x=".5" y=".5" width="9" height="9" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" stroke="currentColor" strokeWidth="1">
      <path d="M0 0l10 10M10 0L0 10" />
    </svg>
  );
}

const control =
  'grid h-full w-[46px] place-items-center text-secondary transition-colors duration-100 hover:bg-quinary hover:text-primary focus-visible:outline-none focus-visible:bg-quinary';

/**
 * The window's title bar: a drag strip the height of the native one, with
 * minimise / maximise / close on Windows and Linux. Double-click maximises
 * (Tauri's drag-region handler). Hidden in OS full screen.
 */
export function TitleBar() {
  const { maximized, fullscreen, focused } = useWindowState();
  if (!isDesktop() || fullscreen) return null;

  return (
    <div
      data-tauri-drag-region
      className="relative z-[calc(var(--z-modal)+1)] flex h-(--titlebar-height) flex-none items-stretch select-none data-[blur=true]:opacity-70"
      data-blur={!focused}
    >
      {/* Room for macOS's traffic lights. */}
      {os === 'macos' && <div data-tauri-drag-region className="w-[78px] flex-none" />}
      <div className="flex flex-none items-stretch pl-1">
        <BackButton />
      </div>
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-center type-footnote text-tertiary">
        <span data-tauri-drag-region className="truncate">
          Prismix
        </span>
      </div>
      {ownControls && (
        <div className="flex flex-none items-stretch">
          <button type="button" className={control} aria-label="Minimize" title="Minimize" onClick={windowControls.minimize}>
            <MinimizeGlyph />
          </button>
          <button
            type="button"
            className={control}
            aria-label={maximized ? 'Restore' : 'Maximize'}
            title={maximized ? 'Restore' : 'Maximize'}
            onClick={windowControls.toggleMaximize}
          >
            <MaximizeGlyph restore={maximized} />
          </button>
          <button
            type="button"
            className={`${control} hover:bg-[#c42b1c] hover:text-white focus-visible:bg-[#c42b1c] focus-visible:text-white`}
            aria-label="Close"
            title="Close"
            onClick={windowControls.close}
          >
            <CloseGlyph />
          </button>
        </div>
      )}
    </div>
  );
}
