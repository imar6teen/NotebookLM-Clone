import Icon from "./Icon";
import GlacierLogo from "./GlacierLogo";

interface HeaderProps {
  onNewChat: () => void;
}

export default function Header({ onNewChat }: HeaderProps) {
  return (
    <header className="fixed top-0 w-full z-50 bg-surface/60 backdrop-blur-xl border-b border-primary/10 shadow-[0_4px_30px_rgba(10,14,26,0.5)]">
      <div className="h-16 w-full px-6 lg:px-8 flex items-center justify-between gap-4">
        {/* Left: Logo & Branding */}
        <div className="flex items-center gap-4 shrink-0">
          <GlacierLogo />
          <div className="flex items-center gap-2.5">
            <span className="text-base font-headline font-semibold tracking-tight text-on-surface">
              Glacier AI
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-label bg-surface-container-high text-primary border border-primary/20">
              Doc Assistant / v1.0
            </span>
          </div>
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-container-lowest/60 border border-outline-variant/30 text-xs text-on-surface-variant">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span>Engine Ready</span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary hover:text-primary-fixed transition-all border border-primary/30 text-sm font-label font-medium shadow-[0_0_20px_rgba(125,211,252,0.08)]"
          >
            <Icon name="add" size={18} />
            <span>New Chat</span>
          </button>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
            <Icon name="person" size={18} className="text-on-primary" />
          </div>
        </div>
      </div>
    </header>
  );
}
